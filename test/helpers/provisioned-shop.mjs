/**
 * A shop with an imaginary Cloudflare account behind it.
 *
 * Shared by the provisioning and deployment suites because both ask the same
 * question — what does shopctl DO to an account — and a second copy of the
 * fixture would be a second account model to keep in step.
 *
 * The shop is built file by file rather than cloned from a core tag: the
 * commands under test read the manifest, the Wrangler template and the
 * migrations directory, and nothing else. Cloning five hundred files per
 * assertion would make the suites slow enough that someone would stop running
 * them, and the shape of a generated tree is already pinned by jalon 2's suite.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { stripAnsi } from '../../shopctl/src/cloudflare.mjs';

const CORE = new URL('../../', import.meta.url).pathname;
const BIN = resolve(CORE, 'shopctl/bin/shopctl.mjs');
const DOUBLE = resolve(CORE, 'test/fixtures/wrangler-double.mjs');

export const ACCOUNT = { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', name: 'Agence' };
export const OTHER_ACCOUNT = { id: '0123456789abcdef0123456789abcdef', name: 'Compte perso' };

/**
 * A shop, small enough to build per test.
 *
 * Not a `shopctl new` clone: provisioning reads the manifest, the Wrangler
 * template and the migrations directory, and nothing else. Cloning five hundred
 * files per assertion would make the suite slow enough that someone would stop
 * running it — and what is under test is the conversation with the account, not
 * the shape of a generated tree, which jalon 2's suite already pins.
 */
export function shop({ accountId = ACCOUNT.id, slug = 'atelier-test', built = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'shopctl-provision-'));
  const core = JSON.parse(readFileSync(resolve(CORE, 'package.json'), 'utf8'));

  mkdirSync(join(root, 'client'), { recursive: true });
  mkdirSync(join(root, 'migrations'), { recursive: true });
  mkdirSync(join(root, 'src/themes/atelier'), { recursive: true });
  mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
  // `--skip-build` refuses to run without one, which is the point of the flag:
  // reusing a build that is not there would upload the previous shop's bundle.
  if (built) mkdirSync(join(root, 'dist/server'), { recursive: true });

  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'shop', version: core.version, private: true }, null, 2));
  cpSync(resolve(CORE, 'wrangler.template.jsonc'), join(root, 'wrangler.template.jsonc'));
  writeFileSync(
    join(root, 'client/client.yaml'),
    [
      'schemaVersion: 1',
      `coreVersion: ${core.version}`,
      'client:',
      `  slug: ${slug}`,
      '  displayName: Boutique de test',
      '  locale: fr-FR',
      '  timezone: Europe/Paris',
      '  currency: EUR',
      'commerce:',
      '  market: FR',
      '  pricesIncludeTax: true',
      '  checkoutMode: guest',
      '  defaultVatRate: 20',
      '  invoiceStrategy: pending-validation',
      'features:',
      '  customerAccounts: false',
      '  semanticSearch: false',
      '  digitalProducts: false',
      '  promoCodes: true',
      '  shipping: true',
      'cloudflare:',
      '  jurisdiction: eu',
      `  workerName: minshop-${slug}`,
      '  productionDomain: boutique.example.fr',
      ...(accountId ? [`  accountId: ${accountId}`] : []),
      'email:',
      '  provider: resend',
      '  from: contact@boutique.example.fr',
      'theme:',
      '  id: atelier',
      '',
    ].join('\n'),
  );

  // `npx --no-install wrangler` resolves the shop's own binary, so the double
  // is installed exactly where the real one would be. Nothing in shopctl knows
  // it is talking to a stand-in.
  const shim = join(root, 'node_modules/.bin/wrangler');
  writeFileSync(shim, `#!/usr/bin/env node\nimport('${DOUBLE}');\n`);
  chmodSync(shim, 0o755);

  const statePath = join(root, 'cf-state.json');
  const state = {
    authenticated: true,
    accounts: [ACCOUNT],
    d1: [],
    r2: [],
    workers: [],
    calls: [],
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  return {
    root,
    slug,
    statePath,
    account(patch) {
      writeFileSync(statePath, JSON.stringify({ ...JSON.parse(readFileSync(statePath, 'utf8')), ...patch }, null, 2));
    },
    read() {
      return JSON.parse(readFileSync(statePath, 'utf8'));
    },
    run(args) {
      const result = spawnSync('node', [BIN, ...args], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, WRANGLER_DOUBLE_STATE: statePath, CLOUDFLARE_ACCOUNT_ID: '' },
      });
      return { ...result, stdout: stripAnsi(result.stdout ?? ''), stderr: stripAnsi(result.stderr ?? '') };
    },
    json(args) {
      const result = this.run([...args, '--json']);
      return { ...result, report: result.stdout.trim() ? JSON.parse(result.stdout) : null };
    },
  };
}

export const names = (slug, env) => ({
  worker: `minshop-${slug}-${env}`,
  database: `minshop-${slug}-${env}-db`,
  images: `minshop-${slug}-${env}-images`,
  files: `minshop-${slug}-${env}-files`,
});
