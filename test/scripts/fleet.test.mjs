import { describe, expect, it, vi } from 'vitest';

// .mjs like its neighbours: tsconfig pins `types` to the Cloudflare types, so
// node builtins have no declarations in a .ts file here.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { EXIT_CODES } from '../../shopctl/src/errors.mjs';
import { compareVersions, isBreakingStep, latestVersion, versionsBetween } from '../../shopctl/src/version.mjs';
import { readRegistry, selectShops } from '../../shopctl/src/fleet.mjs';
import { CORE_TAG, CORE_VERSION, GIT_ENV, cloneCoreTemplate, git, nextMinor, publishVersion } from '../helpers/core-repository.mjs';
import { DEPENDABOT_FILE, renderDependabot } from '../../scripts/dependabot.mjs';
import { scratchDir } from '../helpers/scratch.mjs';

const CORE = new URL('../../', import.meta.url).pathname;
const BIN = resolve(CORE, 'shopctl/bin/shopctl.mjs');
const GH_DOUBLE = resolve(CORE, 'test/fixtures/gh-double.mjs');

// Every test here clones a real core, merges a real tag and runs the real
// gates. Vitest's five-second default is a budget for pure functions; here it
// would only measure how loaded the machine is.
vi.setConfig({ testTimeout: 120_000 });

/**
 * The step under test: from the version THIS tree declares, to the next minor.
 *
 * Derived rather than written down. Literals here would have to be edited at
 * every release, and the release that forgot would build a fixture whose tag
 * and whose package.json disagree — the state a shop's own manifest gate
 * refuses. Publishing v0.2.0 is what taught this file the lesson.
 */
const FROM = CORE_VERSION;
const FROM_TAG = CORE_TAG;
const TO = nextMinor();
const TO_TAG = `v${TO}`;
const UPGRADE_BRANCH = `socle/${TO_TAG}`;

/** The migration a new core version brings: additive, as ADR 0006 requires. */
const ADDITIVE_MIGRATION = [
  '-- Ajout additif : une boutique restée sur la version précédente continue de',
  '-- lire et écrire ses commandes sans connaître cette colonne.',
  'ALTER TABLE orders ADD COLUMN gift_message TEXT;',
  '',
].join('\n');

const NOTES_NEXT = [
  `# Socle ${TO_TAG}`,
  '',
  '## Ce qui change',
  '',
  "- une colonne facultative pour le message cadeau d'une commande.",
  '',
  '## Migrations',
  '',
  '- `migrations/0044_gift_message.sql`, additive.',
  '',
].join('\n');

/**
 * An agency's workspace: one core at its own tag, its shops, and a registry.
 *
 * Built with the REAL commands — the core is this tree's own index, committed
 * and tagged, and `shopctl new` creates each shop from that tag. What is under test is a
 * merge between two real trees, and a fixture that faked either end would prove
 * nothing about the upgrade an agency actually runs.
 */
function workspace({ shops = ['boutique-un'], forge = false, registry = true } = {}) {
  const root = scratchDir('shopctl-fleet-');
  const core = cloneCoreTemplate(root);
  const bin = join(root, '.bin');
  const ghState = join(root, 'gh-state.json');

  if (forge) {
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node\nimport('${GH_DOUBLE}');\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    writeFileSync(ghState, JSON.stringify({ authenticated: true, repos: {}, users: {}, calls: [] }, null, 2));
  }

  const created = [];
  for (const slug of shops) {
    const result = spawnSync(
      'node',
      [BIN, 'new', slug, '--core', FROM_TAG, '--from', core, '--no-install', '--no-verify'],
      { cwd: root, encoding: 'utf8', env: GIT_ENV },
    );
    if (result.status !== 0) throw new Error(`shopctl new ${slug}: ${result.stderr || result.stdout}`);
    const shopRoot = join(root, `shop-${slug}`);
    created.push({ slug, root: shopRoot, path: `shop-${slug}` });

    if (forge) {
      // A LOCAL bare repository reached through `url.<path>.insteadOf`, so the
      // URL shopctl parses and hands to `gh` is a genuine github.com one while
      // the push never leaves the machine.
      const remote = scratchDir('shopctl-remote-');
      const nameWithOwner = `agence/shop-${slug}`;
      const originUrl = `git@github.com:${nameWithOwner}.git`;
      spawnSync('git', ['init', '--bare', '--quiet', remote], { encoding: 'utf8' });
      git(['config', `url.${remote}.insteadOf`, originUrl], shopRoot);
      git(['remote', 'add', 'origin', originUrl], shopRoot);
      git(['push', '--quiet', '-u', 'origin', 'main'], shopRoot);
      const state = JSON.parse(readFileSync(ghState, 'utf8'));
      state.repos[nameWithOwner] = { visibility: 'private', environments: {}, branches: ['main'], pulls: [] };
      writeFileSync(ghState, JSON.stringify(state, null, 2));
    }
  }

  if (registry) {
    writeFileSync(
      join(root, 'fleet.json'),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          core: { repository: core },
          shops: created.map(({ slug, path }) => ({ slug, path })),
        },
        null,
        2,
      )}\n`,
    );
  }

  return {
    root,
    core,
    shops: created,
    shop: (slug = shops[0]) => created.find((entry) => entry.slug === slug).root,
    github: () => JSON.parse(readFileSync(ghState, 'utf8')),
    /** Publish the next core version, with an additive migration and its notes. */
    publish(options = {}) {
      return publishVersion(core, {
        version: TO,
        notes: NOTES_NEXT,
        files: { 'migrations/0044_gift_message.sql': ADDITIVE_MIGRATION },
        ...options,
      });
    },
    /** Run the real binary, in a tree of this workspace. */
    run(args, { cwd = root, env = {} } = {}) {
      const result = spawnSync('node', [BIN, ...args], {
        cwd,
        encoding: 'utf8',
        env: {
          ...GIT_ENV,
          ...(forge ? { PATH: `${bin}:${process.env.PATH}`, GH_DOUBLE_STATE: ghState } : {}),
          ...env,
        },
      });
      return { ...result, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    },
    json(args, options) {
      const result = this.run([...args, '--json'], options);
      return { ...result, report: result.stdout.trim() ? JSON.parse(result.stdout) : null };
    },
  };
}

/** Every file of a directory, repository-relative, sorted. */
function treeFiles(dir, base = dir) {
  const found = [];
  for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (name.name === '.git' || name.name === 'node_modules') continue;
    const path = join(dir, name.name);
    if (name.isDirectory()) found.push(...treeFiles(path, base));
    else found.push([path.slice(base.length + 1), readFileSync(path, 'utf8')]);
  }
  return found;
}

/**
 * The upgraded shop's database, migrated by the wrangler double.
 *
 * The double applies the tree's REAL migrations into a `node:sqlite` database —
 * the forty-three this repository ships plus whatever the upgrade brought — so
 * what is exercised is the actual schema a shop would run, constraints,
 * triggers and generated columns included.
 */
function migrate(shopRoot) {
  const shim = join(shopRoot, 'node_modules/.bin/wrangler');
  mkdirSync(join(shopRoot, 'node_modules/.bin'), { recursive: true });
  writeFileSync(shim, `#!/usr/bin/env node\nimport('${resolve(CORE, 'test/fixtures/wrangler-double.mjs')}');\n`);
  chmodSync(shim, 0o755);
  const statePath = join(shopRoot, 'cf-state.json');
  // The database the shop's own wrangler.jsonc binds — rendered from its
  // manifest by the upgrade itself, so the name and the id come from the shop
  // rather than from this test. The id too: wrangler takes the one the
  // configuration carries at its word.
  const config = read(shopRoot, 'wrangler.jsonc');
  const database = config.match(/"database_name"\s*:\s*"([^"]+)"/)[1];
  const uuid = config.match(/"database_id"\s*:\s*"([^"]+)"/)[1];
  writeFileSync(
    statePath,
    JSON.stringify({ authenticated: true, accounts: [], d1: [{ name: database, uuid }], r2: [], workers: [], calls: [] }, null, 2),
  );
  const wrangler = (args) =>
    spawnSync(shim, args, { cwd: shopRoot, encoding: 'utf8', env: { ...GIT_ENV, WRANGLER_DOUBLE_STATE: statePath } });
  const applied = wrangler(['d1', 'migrations', 'apply', 'DB', '--remote']);
  if (applied.status !== 0) throw new Error(`migrations: ${applied.stderr || applied.stdout}`);
  return {
    /** Run SQL as the shop's code would, and say whether the database took it. */
    exec: (sql) => wrangler(['d1', 'execute', 'DB', '--remote', '--command', sql]),
    query: (sql) => {
      const result = wrangler(['d1', 'execute', 'DB', '--remote', '--json', '--command', sql]);
      if (result.status !== 0) throw new Error(result.stderr || result.stdout);
      return JSON.parse(result.stdout.slice(result.stdout.search(/[[{]/)))[0].results;
    },
  };
}

const read = (root, file) => readFileSync(join(root, file), 'utf8');

/** The version after TO, which a stale clone is upgraded to. */
const NEXT = nextMinor(TO);
const NEXT_TAG = `v${NEXT}`;

/**
 * A shop on TO whose clone never had TO's tag — certification, step 10.
 *
 * The pilot's clone had last fetched the core's tags at v0.3.5. Every upgrade
 * since was merged on the forge and pulled from the shop's own origin, which
 * brings the merge commits and none of the core's tags, so the newest tag its
 * history could show was v0.3.5 for a shop on v0.3.20. Upgraded here, merged
 * into main, and the tag deleted: the same history, missing the same tag.
 */
function staleClone() {
  const agency = workspace();
  const shop = agency.shop();
  agency.publish();
  const upgraded = agency.run(['core', 'upgrade', '--to', TO_TAG], { cwd: shop });
  if (upgraded.status !== 0) throw new Error(`core upgrade ${TO_TAG}: ${upgraded.stderr}`);
  git(['switch', '--quiet', 'main'], shop);
  git(['merge', '--quiet', '--ff-only', UPGRADE_BRANCH], shop);
  git(['tag', '--delete', TO_TAG], shop);
  return { agency, shop };
}

// ---------------------------------------------------------------------------
// The ordering. Pure, and load-bearing: everything else decides what to merge
// by comparing three integers.

describe('core versions, as numbers', () => {
  it('orders them by major, then minor, then patch', () => {
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(latestVersion(['v0.1.0', 'v0.10.0', 'v0.2.0'])).toBe('v0.10.0');
  });

  // The same 0.x reading the manifest gate applies (checkCoreCompatibility):
  // before 1.0 a minor bump may break. The two must agree, or an upgrade that
  // called itself routine would leave a shop its own gate refuses.
  it('calls a pre-1.0 minor bump breaking, and a patch not', () => {
    expect(isBreakingStep('0.1.0', '0.2.0')).toBe(true);
    expect(isBreakingStep('0.1.0', '0.1.4')).toBe(false);
    expect(isBreakingStep('1.4.0', '1.5.0')).toBe(false);
    expect(isBreakingStep('1.4.0', '2.0.0')).toBe(true);
  });

  it('lists the versions a step crosses, oldest first', () => {
    expect(versionsBetween(['0.1.0', '0.2.0', '0.3.0', '0.4.0'], '0.1.0', '0.3.0')).toEqual(['0.2.0', '0.3.0']);
  });
});

// ---------------------------------------------------------------------------

describe('shopctl core status', () => {
  it('reads the version from the history, not from the manifest', () => {
    const agency = workspace();
    const { report } = agency.json(['core', 'status', '--offline'], { cwd: agency.shop() });
    expect(report.core).toMatchObject({ declared: FROM, merged: FROM, mergedTag: FROM_TAG, declaresMerged: true });
    expect(report.shop.slug).toBe('boutique-un');
  });

  // ADR 0003 asks `core status` for exactly this: the manifest is a claim, the
  // merge is the fact, and a manifest edited by hand is how a shop ends up
  // claiming a version it never took.
  it('reports a manifest that claims a version the history does not carry', () => {
    const agency = workspace();
    const shop = agency.shop();
    writeFileSync(
      join(shop, 'client/client.yaml'),
      read(shop, 'client/client.yaml').replace(`coreVersion: ${FROM}`, 'coreVersion: 99.0.0'),
    );
    const { status, report, stderr } = agency.json(['core', 'status', '--offline'], { cwd: shop });
    // Reported, not refused: the manifest no longer validates — it is ahead of
    // the core it sits on — and a status command that declined to describe the
    // shop would leave the operator with nothing to act on.
    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(report.core).toMatchObject({ declared: '99.0.0', merged: FROM, declaresMerged: false });
    expect(report.manifestErrors[0].path).toBe('coreVersion');
    // The verdict travels in the document; the exit code says the read worked.
    expect(report.ok).toBe(false);
    expect(report.findings.some((finding) => finding.status === 'fail')).toBe(true);
  });

  // The same disagreement with the opposite cause: the manifest is right and
  // the clone is short of a tag. Saying only "the manifest declares X" invites
  // the operator to write the stale version back into it.
  it('names the missing tag, not the manifest, in a clone that never fetched it', () => {
    const { agency, shop } = staleClone();
    const { report } = agency.json(['core', 'status', '--offline'], { cwd: shop });
    expect(report.core).toMatchObject({ declared: TO, merged: FROM, declaresMerged: false, declaredUnfetched: true });
    const failure = report.findings.find((finding) => finding.status === 'fail');
    expect(failure.message).toContain(`ce clone n'a pas le tag ${TO_TAG}`);
    expect(failure.message).toContain('git fetch --tags core');

    // Fetched, the history reads what the manifest says.
    git(['fetch', '--quiet', '--tags', 'core'], shop);
    const fetched = agency.json(['core', 'status', '--offline'], { cwd: shop }).report;
    expect(fetched.core).toMatchObject({ merged: TO, declaresMerged: true, declaredUnfetched: false });
  });

  it('counts how many versions the shop is behind', () => {
    const agency = workspace();
    agency.publish();
    const { report } = agency.json(['core', 'status'], { cwd: agency.shop() });
    expect(report.core.behind).toEqual([TO]);
    expect(report.core.latest).toBe(TO);
  });

  // The tree is built here rather than reused from the fixture, and the reason
  // is a CI job: « Generated shop » runs this whole suite INSIDE a shop created
  // by `shopctl new`, and the fixture core is a copy of whatever tree is under
  // test — so there, the "core" carries a client/client.yaml and `core status`
  // legitimately describes it. What the command refuses is a tree that is
  // neither, and that is what this builds.
  it('refuses to run outside a shop', () => {
    const elsewhere = scratchDir('shopctl-not-a-shop-');
    git(['init', '--quiet', '--initial-branch=main'], elsewhere);
    const result = spawnSync('node', [BIN, 'core', 'status'], { cwd: elsewhere, encoding: 'utf8', env: GIT_ENV });
    expect(result.status).toBe(EXIT_CODES.precondition);
    expect(result.stderr).toMatch(/n'est pas une boutique/);
  });
});

// ---------------------------------------------------------------------------

describe('shopctl core upgrade', () => {
  it('merges the tag, bumps only coreVersion, and brings the migration', () => {
    const agency = workspace();
    agency.publish();
    const shop = agency.shop();
    const before = read(shop, 'client/client.yaml');
    const theme = treeFiles(join(shop, 'src/themes/boutique-un'));

    const { status, report, stderr } = agency.json(['core', 'upgrade', '--to', TO_TAG], { cwd: shop });
    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(report).toMatchObject({ ok: true, from: FROM, to: TO, changed: true, branch: UPGRADE_BRANCH });
    expect(report.migrations).toEqual(['migrations/0044_gift_message.sql']);
    expect(report.notes).toEqual([{ version: TO, file: `docs/migrations/${TO_TAG}.md` }]);

    // The migration arrived, and the shop is on the branch the report names.
    expect(existsSync(join(shop, 'migrations/0044_gift_message.sql'))).toBe(true);
    expect(git(['symbolic-ref', '--short', 'HEAD'], shop)).toBe(UPGRADE_BRANCH);

    // The manifest changed in exactly one line, and the theme not at all: the
    // two properties jalon 9 asks for by name.
    const after = read(shop, 'client/client.yaml');
    expect(after).toBe(before.replace(`coreVersion: ${FROM}`, `coreVersion: ${TO}`));
    expect(treeFiles(join(shop, 'src/themes/boutique-un'))).toEqual(theme);

    // And the shop still passes its own gates, with the NEW core's copy of them.
    const gates = agency.run(['config', 'validate'], { cwd: shop });
    expect(gates.status, gates.stdout).toBe(EXIT_CODES.ok);

    // Every file the step changed is the release's, the manifest's or a render:
    // the pull request's core-change gate has nothing to ask (ticket #86).
    expect(report.coreChange).toEqual({ evaluated: true, paths: [], approved: null });
    expect(stderr).toContain('porte core-change : aucun fichier du cœur à approuver');
  });

  // Ticket #86. A core file both sides edited merges cleanly and comes out as
  // neither's copy: the File ownership job of the pull request then fails on
  // it. The upgrade said ✓ throughout, on two demonstration shops. It now
  // names the file and the way to approve it, in its report and in the pull
  // request.
  it('names the core files the pull request will ask an approval for', () => {
    const agency = workspace({ forge: true });
    const shop = agency.shop();
    const original = read(shop, 'scripts/check-toolchain.mjs');
    writeFileSync(join(shop, 'scripts/check-toolchain.mjs'), `${original}// note de la boutique\n`);
    git(['add', '-A'], shop);
    git(['commit', '--quiet', '-m', 'Annoter un fichier du cœur', '-m', 'Approves-core-change: une note'], shop);
    agency.publish({ files: { 'scripts/check-toolchain.mjs': `// correctif du socle\n${original}` } });

    const { status, report, stderr } = agency.json(['core', 'upgrade', '--to', TO_TAG, '--open-pr'], { cwd: shop });
    // Not a refusal: the merge is sound, and an approval settles it.
    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(read(shop, 'scripts/check-toolchain.mjs')).toBe(`// correctif du socle\n${original}// note de la boutique\n`);
    // The shop's earlier approval is outside the step's range: it approved the
    // edit, not what a merge made of it.
    expect(report.coreChange).toEqual({ evaluated: true, paths: ['scripts/check-toolchain.mjs'], approved: null });
    expect(stderr).toContain('le job « File ownership » de la pull request échouera');
    expect(stderr).toContain('  scripts/check-toolchain.mjs');
    expect(stderr).toContain('Approves-core-change: <raison>');
    const [pull] = agency.github().repos['agence/shop-boutique-un'].pulls;
    expect(pull.body).toContain('## Écarts du cœur à approuver (1)');
    expect(pull.body).toContain('- `scripts/check-toolchain.mjs`');
    expect(pull.body).toContain('- [ ] écarts du cœur relus et approuvés');

    // Approved on the branch, the way the demo shops did it: the re-run says so.
    git(['commit', '--quiet', '--allow-empty', '-m', 'Approuver la fusion', '-m', 'Approves-core-change: note gardée'], shop);
    const again = agency.json(['core', 'upgrade', '--to', TO_TAG], { cwd: shop });
    expect(again.status, again.stderr).toBe(EXIT_CODES.ok);
    expect(again.report.coreChange).toEqual({
      evaluated: true,
      paths: ['scripts/check-toolchain.mjs'],
      approved: 'Approves-core-change: note gardée',
    });
    expect(again.stderr).toContain('approuvé par Approves-core-change: note gardée');
  });

  // The label is set on the pull request, in CI: an operator's shell that
  // carries the variable is not an approval anyone gave.
  it('judges the core-change gate without the operator’s MINSHOP_CORE_CHANGE', () => {
    const agency = workspace();
    const shop = agency.shop();
    const original = read(shop, 'scripts/check-toolchain.mjs');
    writeFileSync(join(shop, 'scripts/check-toolchain.mjs'), `${original}// note de la boutique\n`);
    git(['add', '-A'], shop);
    git(['commit', '--quiet', '-m', 'Annoter un fichier du cœur'], shop);
    agency.publish({ files: { 'scripts/check-toolchain.mjs': `// correctif du socle\n${original}` } });

    const { status, report } = agency.json(['core', 'upgrade', '--to', TO_TAG], { cwd: shop, env: { MINSHOP_CORE_CHANGE: 'approved' } });
    expect(status).toBe(EXIT_CODES.ok);
    expect(report.coreChange).toMatchObject({ paths: ['scripts/check-toolchain.mjs'], approved: null });
  });

  // Read before the fetch, the stale clone's starting point was the last tag
  // it happened to have: the report, and the pull request built from it,
  // carried every note and migration since, and every file changed since as
  // drift.
  it('starts from the version the shop is on, in a clone that never fetched its tag', () => {
    const { agency, shop } = staleClone();
    publishVersion(agency.core, {
      version: NEXT,
      notes: `# Socle ${NEXT_TAG}\n\n## Migrations\n\n- \`migrations/0046_gift_wrap.sql\`, additive.\n`,
      files: { 'migrations/0046_gift_wrap.sql': 'ALTER TABLE orders ADD COLUMN gift_wrap INTEGER;\n' },
    });

    const { status, report, stderr } = agency.json(['core', 'upgrade', '--to', NEXT_TAG], { cwd: shop });
    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(report).toMatchObject({ from: TO, to: NEXT, changed: true });
    expect(report.notes.map((note) => note.version)).toEqual([NEXT]);
    expect(report.migrations).toEqual(['migrations/0046_gift_wrap.sql']);
    expect(report.drift).toEqual([]);
    expect(stderr).toContain(`socle ${TO_TAG} → ${NEXT_TAG}`);
  });

  // "L'ancien Worker reste compatible avec le nouveau schéma" (jalon 9, ADR
  // 0006), asked of the schema rather than of a promise: the migration the new
  // version brings is applied to a database carrying the real forty-three, and
  // then the WRITE the previous version performs — which names none of the new
  // columns — has to still be accepted. An additive column that arrived NOT
  // NULL without a default would fail exactly here, which is the failure this
  // test exists to make loud.
  it('leaves the previous version\'s writes working on the new schema', () => {
    const agency = workspace();
    agency.publish();
    const shop = agency.shop();
    expect(agency.run(['core', 'upgrade', '--to', TO_TAG], { cwd: shop }).status).toBe(EXIT_CODES.ok);

    const db = migrate(shop);
    const legacyWrite = db.exec(
      "INSERT INTO orders (provider_session_id, email, amount_total_cents, currency, status) " +
        "VALUES ('cs_ancienne_version', 'client@example.fr', 4200, 'EUR', 'paid')",
    );
    expect(legacyWrite.status, legacyWrite.stderr).toBe(0);

    // And the column the new version added is there, empty, for the code that
    // knows about it.
    const [order] = db.query("SELECT gift_message, amount_total_cents FROM orders WHERE provider_session_id = 'cs_ancienne_version'");
    expect(order).toMatchObject({ gift_message: null, amount_total_cents: 4200 });
  });

  it('says there is nothing to do when the shop is already there', () => {
    const agency = workspace();
    const { status, report } = agency.json(['core', 'upgrade', '--to', FROM_TAG], { cwd: agency.shop() });
    expect(status).toBe(EXIT_CODES.ok);
    expect(report).toMatchObject({ changed: false, upToDate: true });
  });

  // A published tag is immutable (ADR 0003): a faulty version is corrected by
  // the next one. Merging backwards would leave a history claiming a version
  // its files do not have.
  it('refuses to go backwards', () => {
    const agency = workspace();
    agency.publish();
    const shop = agency.shop();
    agency.run(['core', 'upgrade', '--to', TO_TAG], { cwd: shop });
    const result = agency.run(['core', 'upgrade', '--to', FROM_TAG], { cwd: shop });
    expect(result.status).toBe(EXIT_CODES.input);
    expect(result.stderr).toMatch(/antérieur/);
  });

  it('refuses a version the core does not publish', () => {
    const agency = workspace();
    const result = agency.run(['core', 'upgrade', '--to', 'v9.9.9'], { cwd: agency.shop() });
    expect(result.status).toBe(EXIT_CODES.input);
    expect(result.stderr).toMatch(/v9\.9\.9/);
  });

  it('refuses a dirty working tree before it merges anything', () => {
    const agency = workspace();
    agency.publish();
    const shop = agency.shop();
    writeFileSync(join(shop, 'src/store.config.ts'), '// travail en cours\n');
    const result = agency.run(['core', 'upgrade', '--to', TO_TAG], { cwd: shop });
    expect(result.status).toBe(EXIT_CODES.precondition);
    expect(git(['symbolic-ref', '--short', 'HEAD'], shop)).toBe('main');
  });

  it('changes nothing under --dry-run, and still says what the step carries', () => {
    const agency = workspace();
    agency.publish();
    const shop = agency.shop();
    const head = git(['rev-parse', 'HEAD'], shop);

    const { status, report } = agency.json(['core', 'upgrade', '--to', TO_TAG, '--dry-run'], { cwd: shop });
    expect(status).toBe(EXIT_CODES.ok);
    expect(report).toMatchObject({ dryRun: true, changed: false, branch: UPGRADE_BRANCH });
    expect(report.migrations).toEqual(['migrations/0044_gift_message.sql']);
    expect(git(['rev-parse', 'HEAD'], shop)).toBe(head);
    expect(git(['symbolic-ref', '--short', 'HEAD'], shop)).toBe('main');
  });

  // The deliberate conflict of jalon 9's test list. The shop edits a core file;
  // the next core version edits the same lines. What must NOT happen is a
  // silent resolution — the operator has to be told which files, and the merge
  // is left in the tree because resolving it is git work in that tree.
  it('reports a conflict by file and leaves the merge in place', () => {
    const agency = workspace();
    const shop = agency.shop();
    writeFileSync(join(shop, 'scripts/check-toolchain.mjs'), '// correctif urgent de la boutique\n');
    git(['add', '-A'], shop);
    git(['commit', '--quiet', '-m', 'Corriger un fichier du cœur en urgence'], shop);
    agency.publish({ files: { 'scripts/check-toolchain.mjs': '// correctif du socle\n' } });

    const result = agency.run(['core', 'upgrade', '--to', TO_TAG], { cwd: shop });
    expect(result.status).toBe(EXIT_CODES.verification);
    expect(result.stderr).toMatch(/conflit/);
    // Named WITH its ownership: a conflict in a core file is the agency's to
    // resolve, and the label is what says so without opening the file.
    expect(result.stderr).toContain('scripts/check-toolchain.mjs (core)');
    // Left mid-merge, with the markers, on the upgrade branch.
    expect(git(['symbolic-ref', '--short', 'HEAD'], shop)).toBe(UPGRADE_BRANCH);
    expect(read(shop, 'scripts/check-toolchain.mjs')).toContain('<<<<<<<');
  });

  // The ordinary sequel to the test above: the operator resolves the conflict,
  // commits, and runs the same command again. The merge is then already in the
  // history — and everything AFTER it has never run. A command that answered
  // "already there" here would leave the shop merged, its manifest still
  // claiming the old version, and nothing proposed to anyone.
  it('finishes an upgrade whose conflict was resolved by hand', () => {
    const agency = workspace({ forge: true });
    const shop = agency.shop();
    writeFileSync(join(shop, 'scripts/check-toolchain.mjs'), '// correctif urgent de la boutique\n');
    git(['add', '-A'], shop);
    git(['commit', '--quiet', '-m', 'Corriger un fichier du cœur en urgence'], shop);
    agency.publish({ files: { 'scripts/check-toolchain.mjs': '// correctif du socle\n' } });
    expect(agency.run(['core', 'upgrade', '--to', TO_TAG], { cwd: shop }).status).toBe(EXIT_CODES.verification);

    // Resolved the way an operator resolves it: keep both decisions, commit.
    writeFileSync(join(shop, 'scripts/check-toolchain.mjs'), '// correctif urgent de la boutique\n// correctif du socle\n');
    git(['add', '-A'], shop);
    git(['commit', '--quiet', '--no-edit'], shop);

    const { status, report, stderr } = agency.json(['core', 'upgrade', '--to', TO_TAG, '--open-pr'], { cwd: shop });
    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(report).toMatchObject({ from: FROM, to: TO, changed: true, base: 'main' });
    expect(read(shop, 'client/client.yaml')).toContain(`coreVersion: ${TO}`);
    expect(agency.github().repos['agence/shop-boutique-un'].pulls).toHaveLength(1);
  });

  // The shop's `wrangler.jsonc` is rendered from its manifest and differs from
  // the core's own from the first line, so every core version that edits the
  // core's copy conflicts there. v0.3.26 stopped the pilot's upgrade on it, for
  // a file the next step re-renders anyway (certification, step 11).
  it('resolves a conflict on a generated file by itself, and renders it again', () => {
    const agency = workspace();
    const shop = agency.shop();
    const rendered = read(shop, 'wrangler.jsonc');
    // The Worker's name: the one line every rendering rewrites, whatever the
    // core's copy is — the committed default here, a template rendering in CI,
    // whose `run-verify` renders it before the suite.
    const coreConfig = read(agency.core, 'wrangler.jsonc');
    const edited = coreConfig.replace(/^(\s*)"name": "[^"]+",$/m, '$1"name": "minshop-next-core",');
    expect(edited).not.toBe(coreConfig);
    agency.publish({ files: { 'wrangler.jsonc': edited } });

    const { status, report, stderr } = agency.json(['core', 'upgrade', '--to', TO_TAG], { cwd: shop });
    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(report).toMatchObject({ from: FROM, to: TO, changed: true });
    expect(stderr).toContain('repris du socle : wrangler.jsonc');
    // Rendered from the shop's manifest again, not the core's copy, and no marker.
    expect(read(shop, 'wrangler.jsonc')).toBe(rendered);
    expect(git(['log', '-2', '--format=%s'], shop).split('\n')).toEqual([
      `Passer la boutique boutique-un au socle ${TO_TAG}`,
      `Fusionner le socle ${TO_TAG}`,
    ]);
  });

  // Ticket #81. A shop renders .github/dependabot.yml for itself, so a release
  // that edits the core's conflicts there exactly like wrangler.jsonc: taken
  // from the core, rendered again for the shop, and nothing to approve.
  it('renders a shop’s Dependabot configuration again after a release that edits the core’s', () => {
    const agency = workspace();
    const shop = agency.shop();
    expect(read(shop, DEPENDABOT_FILE)).toBe(renderDependabot({ shop: true }));
    const daily = (text) => text.replace('interval: "weekly"\n    open-pull-requests-limit: 5', 'interval: "daily"\n    open-pull-requests-limit: 5');
    const generator = read(agency.core, 'scripts/dependabot.mjs');
    expect(daily(generator)).not.toBe(generator);
    agency.publish({ files: { 'scripts/dependabot.mjs': daily(generator), [DEPENDABOT_FILE]: daily(read(agency.core, DEPENDABOT_FILE)) } });

    const { status, report, stderr } = agency.json(['core', 'upgrade', '--to', TO_TAG], { cwd: shop });
    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(stderr).toContain(`repris du socle : ${DEPENDABOT_FILE}`);
    expect(read(shop, DEPENDABOT_FILE)).toBe(renderDependabot({ shop: true }));
    expect(report.coreChange).toEqual({ evaluated: true, paths: [], approved: null });
  });

  // A shop created before ticket #81 carries the core's copy: its first upgrade
  // renders the shop's, and the pull request's gate takes it for a render.
  it('gives a shop created before ticket #81 its own Dependabot configuration', () => {
    const agency = workspace();
    const shop = agency.shop();
    writeFileSync(join(shop, DEPENDABOT_FILE), renderDependabot({ shop: false }));
    git(['add', '-A'], shop);
    git(['commit', '--quiet', '-m', 'La boutique d’avant le ticket #81'], shop);
    agency.publish();

    const { status, report, stderr } = agency.json(['core', 'upgrade', '--to', TO_TAG], { cwd: shop });
    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(read(shop, DEPENDABOT_FILE)).toBe(renderDependabot({ shop: true }));
    expect(git(['show', '--name-only', '--format=', 'HEAD'], shop).split('\n')).toContain(DEPENDABOT_FILE);
    expect(report.coreChange).toEqual({ evaluated: true, paths: [], approved: null });
  });

  // Resumed, the step used to start from the newest LOCAL tag below the target.
  // A shop that skips a version the clone has fetched would then lose that
  // version's notes and migrations from its pull request.
  it('resumes a step that skips a version from where the shop was', () => {
    const agency = workspace();
    const shop = agency.shop();
    writeFileSync(join(shop, 'scripts/check-toolchain.mjs'), '// correctif urgent de la boutique\n');
    git(['add', '-A'], shop);
    git(['commit', '--quiet', '-m', 'Corriger un fichier du cœur en urgence'], shop);
    agency.publish();
    publishVersion(agency.core, {
      version: NEXT,
      notes: `# Socle ${NEXT_TAG}\n\n## Migrations\n\n- aucune.\n`,
      files: { 'scripts/check-toolchain.mjs': '// correctif du socle\n' },
    });
    expect(agency.run(['core', 'upgrade', '--to', NEXT_TAG], { cwd: shop }).status).toBe(EXIT_CODES.verification);

    writeFileSync(join(shop, 'scripts/check-toolchain.mjs'), '// correctif urgent de la boutique\n// correctif du socle\n');
    git(['add', '-A'], shop);
    git(['commit', '--quiet', '--no-edit'], shop);

    const { status, report, stderr } = agency.json(['core', 'upgrade', '--to', NEXT_TAG], { cwd: shop });
    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(report).toMatchObject({ from: FROM, to: NEXT, changed: true });
    expect(report.notes.map((note) => note.version)).toEqual([TO, NEXT]);
    expect(report.migrations).toEqual(['migrations/0044_gift_message.sql']);
    expect(stderr).toContain(`socle ${FROM_TAG} → ${NEXT_TAG}`);
  });

  it('backs the merge out when asked, leaving the branch clean', () => {
    const agency = workspace();
    const shop = agency.shop();
    writeFileSync(join(shop, 'scripts/check-toolchain.mjs'), '// correctif urgent de la boutique\n');
    git(['add', '-A'], shop);
    git(['commit', '--quiet', '-m', 'Corriger un fichier du cœur en urgence'], shop);
    agency.publish({ files: { 'scripts/check-toolchain.mjs': '// correctif du socle\n' } });

    const result = agency.run(['core', 'upgrade', '--to', TO_TAG, '--abort-on-conflict'], { cwd: shop });
    expect(result.status).toBe(EXIT_CODES.verification);
    expect(read(shop, 'scripts/check-toolchain.mjs')).not.toContain('<<<<<<<');
    expect(git(['status', '--porcelain'], shop)).toBe('');
  });

  // ADR 0006: a database that already ran a migration will not run it again, so
  // a core version that edits one leaves the fleet on schemas nobody can
  // reproduce. The shop refuses the step rather than discovering it at deploy.
  it('refuses a version that rewrites a published migration', () => {
    const agency = workspace();
    const existing = readdirSync(join(agency.core, 'migrations')).sort()[0];
    agency.publish({ files: { [`migrations/${existing}`]: '-- réécrite\nSELECT 1;\n' } });

    const result = agency.run(['core', 'upgrade', '--to', TO_TAG], { cwd: agency.shop() });
    expect(result.status).toBe(EXIT_CODES.verification);
    expect(result.stderr).toMatch(/réécrit/);
    expect(result.stderr).toContain(existing);
    // Nothing was merged: the branch was never created.
    expect(git(['symbolic-ref', '--short', 'HEAD'], agency.shop())).toBe('main');
  });

  it('opens one pull request, and does not open a second on a re-run', () => {
    const agency = workspace({ forge: true });
    agency.publish();
    const shop = agency.shop();

    const first = agency.json(['core', 'upgrade', '--to', TO_TAG, '--open-pr'], { cwd: shop });
    expect(first.status, first.stderr).toBe(EXIT_CODES.ok);
    expect(first.report.pullRequest).toMatchObject({ created: true, state: 'OPEN' });

    const pulls = agency.github().repos['agence/shop-boutique-un'].pulls;
    expect(pulls).toHaveLength(1);
    expect(pulls[0].base).toBe('main');
    expect(pulls[0].head).toBe(UPGRADE_BRANCH);
    // The reviewer reads the migration notes without opening the diff, and
    // reads that nothing was deployed.
    expect(pulls[0].body).toContain('migrations/0044_gift_message.sql');
    expect(pulls[0].body).toContain('Rien n\'a été déployé');

    const again = agency.json(['core', 'upgrade', '--to', TO_TAG, '--open-pr'], { cwd: shop });
    expect(again.status).toBe(EXIT_CODES.ok);
    expect(agency.github().repos['agence/shop-boutique-un'].pulls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('the fleet registry', () => {
  const registryAt = (root, document) => {
    const file = join(root, 'fleet.json');
    writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
    return file;
  };

  it('reads shops relative to its own directory', () => {
    const root = scratchDir('registry-');
    mkdirSync(join(root, 'shop-a/client'), { recursive: true });
    writeFileSync(join(root, 'shop-a/client/client.yaml'), 'schemaVersion: 1\n');
    const fleet = readRegistry(
      registryAt(root, { schemaVersion: 1, core: { repository: 'git@github.com:agence/socle.git' }, shops: [{ slug: 'a', path: 'shop-a' }] }),
    );
    expect(fleet.shops[0]).toMatchObject({ slug: 'a', root: join(root, 'shop-a'), exists: true, isShop: true });
  });

  it('refuses a schema version it does not read', () => {
    const root = scratchDir('registry-');
    expect(() => readRegistry(registryAt(root, { schemaVersion: 2, shops: [{ slug: 'a', path: 'shop-a' }] }))).toThrow(/schemaVersion/);
  });

  // Two entries for one shop would upgrade it twice and report it twice, and
  // the second report would describe a tree the first had already moved.
  it('refuses the same shop declared twice', () => {
    const root = scratchDir('registry-');
    expect(() =>
      readRegistry(registryAt(root, { schemaVersion: 1, shops: [{ slug: 'a', path: 'x' }, { slug: 'a', path: 'y' }] })),
    ).toThrow(/deux fois/);
  });

  it('refuses --only naming a shop it has never heard of', () => {
    const root = scratchDir('registry-');
    const fleet = readRegistry(registryAt(root, { schemaVersion: 1, shops: [{ slug: 'a', path: 'x' }] }));
    expect(selectShops(fleet, 'a').map((shop) => shop.slug)).toEqual(['a']);
    expect(() => selectShops(fleet, 'b')).toThrow(/inconnue/);
  });

  it('says how to write one when there is none', () => {
    const agency = workspace({ registry: false });
    const result = agency.run(['fleet', 'status'], { cwd: agency.root });
    expect(result.status).toBe(EXIT_CODES.precondition);
    expect(result.stderr).toContain('fleet.json');
    expect(result.stderr).toContain('schemaVersion');
  });
});

// ---------------------------------------------------------------------------

describe('shopctl fleet', () => {
  it('reports every shop, and the versions the fleet spreads over', () => {
    const agency = workspace({ shops: ['boutique-un', 'boutique-deux'] });
    agency.publish();
    const { status, report } = agency.json(['fleet', 'status']);
    expect(status).toBe(EXIT_CODES.ok);
    expect(report.shops.map((shop) => shop.slug)).toEqual(['boutique-un', 'boutique-deux']);
    expect(report.core.latest).toBe(TO);
    expect(report.spread).toEqual([{ version: FROM, shops: ['boutique-un', 'boutique-deux'] }]);
  });

  // Plan §5.7 names this one by its flag: `shopctl fleet report --format json`
  // is the version report an agency archives, so the document has to be a
  // document — one JSON object on stdout, progress on stderr.
  it('writes the version report as one JSON document, without --json', () => {
    const agency = workspace({ shops: ['boutique-un', 'boutique-deux'] });
    const result = agency.run(['fleet', 'report', '--format', 'json', '--offline']);
    expect(result.status).toBe(EXIT_CODES.ok);
    const document = JSON.parse(result.stdout);
    expect(document.shops.map((shop) => shop.slug)).toEqual(['boutique-un', 'boutique-deux']);
    expect(document.spread).toEqual([{ version: FROM, shops: ['boutique-un', 'boutique-deux'] }]);
  });

  it('refuses a report format it does not write', () => {
    const agency = workspace();
    const result = agency.run(['fleet', 'report', '--format', 'yaml', '--offline']);
    expect(result.status).toBe(EXIT_CODES.usage);
  });

  it('fails verification when a registered shop is not there', () => {
    const agency = workspace({ shops: ['boutique-un'] });
    rmSync(agency.shop(), { recursive: true, force: true });
    const result = agency.run(['fleet', 'verify', '--offline']);
    expect(result.status).toBe(EXIT_CODES.verification);
    expect(result.stderr).toMatch(/boutique-un/);
  });

  // The registry says which shop a directory holds; the manifest says which one
  // it IS. When they disagree every later command would operate on the wrong
  // shop — including the one that merges and pushes.
  it('fails verification when the registry points at the wrong tree', () => {
    const agency = workspace({ shops: ['boutique-un'] });
    writeFileSync(
      join(agency.root, 'fleet.json'),
      `${JSON.stringify({ schemaVersion: 1, shops: [{ slug: 'boutique-deux', path: 'shop-boutique-un' }] }, null, 2)}\n`,
    );
    const result = agency.run(['fleet', 'verify', '--offline']);
    expect(result.status).toBe(EXIT_CODES.verification);
    expect(result.stderr).toContain('boutique-un');
  });

  // Drift is a warning, not a failure: a shop that hotfixed a core file is in a
  // state its agency chose. `--strict` is for the CI job that wants the fleet
  // to be exactly what the core says it is.
  it('counts drift as a warning, and as a failure under --strict', () => {
    const agency = workspace({ shops: ['boutique-un'] });
    const shop = agency.shop();
    writeFileSync(join(shop, 'scripts/check-toolchain.mjs'), '// correctif urgent\n');
    git(['add', '-A'], shop);
    git(['commit', '--quiet', '-m', 'Corriger un fichier du cœur en urgence'], shop);

    const lenient = agency.json(['fleet', 'verify', '--offline']);
    expect(lenient.status).toBe(EXIT_CODES.ok);
    expect(lenient.report.shops[0].state.drift).toEqual([{ path: 'scripts/check-toolchain.mjs', owner: 'core' }]);

    expect(agency.run(['fleet', 'verify', '--offline', '--strict']).status).toBe(EXIT_CODES.verification);
  });

  it('upgrades both witness shops, leaving each theme and manifest alone', () => {
    const agency = workspace({ shops: ['boutique-un', 'boutique-deux'] });
    agency.publish();
    const before = agency.shops.map((shop) => ({
      slug: shop.slug,
      manifest: read(shop.root, 'client/client.yaml'),
      theme: treeFiles(join(shop.root, 'src/themes', shop.slug)),
    }));

    const { status, report, stderr } = agency.json(['fleet', 'upgrade', '--to', TO_TAG]);
    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(report.results.map((result) => [result.slug, result.ok, result.to])).toEqual([
      ['boutique-un', true, TO],
      ['boutique-deux', true, TO],
    ]);

    for (const shop of agency.shops) {
      const expected = before.find((entry) => entry.slug === shop.slug);
      expect(read(shop.root, 'client/client.yaml')).toBe(expected.manifest.replace(`coreVersion: ${FROM}`, `coreVersion: ${TO}`));
      expect(treeFiles(join(shop.root, 'src/themes', shop.slug))).toEqual(expected.theme);
      expect(existsSync(join(shop.root, 'migrations/0044_gift_message.sql'))).toBe(true);
    }
  });

  // A fleet is never upgraded in one block (ADR 0003). The shop left behind
  // must keep working — on its own core version, with its own gates — because
  // that is what "a shop may stay on an earlier version" costs if it is false.
  it('leaves an unselected shop on its version, still passing its own gates', () => {
    const agency = workspace({ shops: ['boutique-un', 'boutique-deux'] });
    agency.publish();
    const behind = agency.shop('boutique-deux');

    const { status } = agency.json(['fleet', 'upgrade', '--to', TO_TAG, '--only', 'boutique-un']);
    expect(status).toBe(EXIT_CODES.ok);

    const state = agency.json(['core', 'status', '--offline'], { cwd: behind });
    expect(state.report.core).toMatchObject({ declared: FROM, merged: FROM, declaresMerged: true });
    expect(existsSync(join(behind, 'migrations/0044_gift_message.sql'))).toBe(false);

    const gates = agency.run(['config', 'validate'], { cwd: behind });
    expect(gates.status, gates.stdout).toBe(EXIT_CODES.ok);
  });

  // One shop's problem is not the fleet's: a run that died on the first would
  // have to be re-run shop by shop, which is what the operator was avoiding.
  it('keeps going past a shop it cannot upgrade, and reports it', () => {
    const agency = workspace({ shops: ['boutique-un', 'boutique-deux'] });
    agency.publish();
    // A dirty tree in the FIRST shop: refused, by name, while the second is
    // upgraded anyway.
    writeFileSync(join(agency.shop('boutique-un'), 'src/store.config.ts'), '// travail en cours\n');

    const { status, report } = agency.json(['fleet', 'upgrade', '--to', TO_TAG]);
    expect(status).toBe(EXIT_CODES.verification);
    expect(report.results.find((result) => result.slug === 'boutique-un')).toMatchObject({ ok: false, kind: 'precondition' });
    expect(report.results.find((result) => result.slug === 'boutique-deux')).toMatchObject({ ok: true, changed: true });
  });

  it('opens one pull request per shop, and deploys nothing', () => {
    const agency = workspace({ shops: ['boutique-un', 'boutique-deux'], forge: true });
    agency.publish();

    const { status, report, stderr } = agency.json(['fleet', 'upgrade', '--to', TO_TAG, '--open-pr']);
    expect(status, stderr).toBe(EXIT_CODES.ok);
    expect(report.results.every((result) => result.pullRequest?.url)).toBe(true);

    const repos = agency.github().repos;
    expect(repos['agence/shop-boutique-un'].pulls).toHaveLength(1);
    expect(repos['agence/shop-boutique-deux'].pulls).toHaveLength(1);
    // Nothing merged: the shops are still on their upgrade branches, and the
    // pull requests are open. A fleet upgrade proposes; a human disposes.
    expect(repos['agence/shop-boutique-un'].pulls[0].state).toBe('OPEN');
  });
});
