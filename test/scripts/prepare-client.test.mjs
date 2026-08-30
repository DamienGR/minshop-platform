import { describe, expect, it } from 'vitest';

// .mjs for the same reason as its neighbours: tsconfig pins `types` to the
// Cloudflare types, so node builtins have no declarations in a .ts file here.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  clientNeedles,
  clientSlugs,
  discoverManifests,
  findClientLeaks,
  loadManifest,
  renderWrangler,
} from '../../scripts/manifest.mjs';

const root = new URL('../../', import.meta.url).pathname;
const shops = () => discoverManifests(root).map((file) => loadManifest(file, { root }));

/** Render a shop's Wrangler configuration somewhere harmless. The script writes
 *  wrangler.jsonc by default, and a test that mutated the working tree would be
 *  a test nobody runs twice. */
function prepare(slug) {
  const out = join(mkdtempSync(join(tmpdir(), 'minshop-prepare-')), 'wrangler.jsonc');
  const stdout = execFileSync('node', ['scripts/prepare-client.mjs', slug, '--out', out, '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  return { report: JSON.parse(stdout), config: readFileSync(out, 'utf8') };
}

describe('rendering the Wrangler configuration', () => {
  it('substitutes every placeholder', () => {
    const out = renderWrangler('name "__NAME__" db "__DB_NAME__"', { __NAME__: 'a', __DB_NAME__: 'b' });
    expect(out).toBe('name "a" db "b"');
  });

  // A placeholder no manifest value fills would otherwise reach Wrangler as a
  // literal resource name — and be created under that name.
  it('refuses a placeholder it cannot fill', () => {
    expect(() => renderWrangler('name "__NAME__" kv "__KV_ID__"', { __NAME__: 'a' })).toThrow(/__KV_ID__/);
  });
});

describe('preparing a shop', () => {
  it.each([
    ['pilot-fr', 'studio'],
    ['canary-minimal', 'market'],
  ])('derives %s from its manifest', (slug, theme) => {
    const { report, config } = prepare(slug);
    expect(report.theme).toBe(theme);
    expect(report.substitutions.__NAME__).toBe(`minshop-${slug}`);
    expect(config).toContain(`"name": "minshop-${slug}"`);
    expect(config).toContain(`"database_name": "minshop-${slug}-db"`);
    expect(config).toContain(`"bucket_name": "minshop-${slug}-images"`);
    expect(config).toContain(`"bucket_name": "minshop-${slug}-files"`);
    expect(config).not.toMatch(/__[A-Z_]+__/);
  });

  // Same template as provision-cf.sh renders, so a witness build and a real
  // provisioning cannot disagree about which bindings a shop gets.
  it('gives the two shops disjoint resource names', () => {
    const a = prepare('pilot-fr').report.substitutions;
    const b = prepare('canary-minimal').report.substitutions;
    for (const key of ['__NAME__', '__DB_NAME__', '__BUCKET__', '__FILES_BUCKET__']) {
      expect(a[key]).not.toBe(b[key]);
    }
  });

  it('lists the shops this tree describes', () => {
    expect(clientSlugs(root).sort()).toEqual(['canary-minimal', 'pilot-fr']);
    const listed = JSON.parse(execFileSync('node', ['scripts/prepare-client.mjs', '--list'], { cwd: root, encoding: 'utf8' }));
    expect(listed.sort()).toEqual(['canary-minimal', 'pilot-fr']);
  });

  it('refuses a slug no manifest declares', () => {
    expect(() => execFileSync('node', ['scripts/prepare-client.mjs', 'no-such-shop'], { cwd: root, stdio: 'pipe' })).toThrow();
  });
});

describe('client neutrality', () => {
  const needles = clientNeedles(shops()[0].manifest);

  it('names the values a shop is free to choose, and nothing the core may know', () => {
    // `EUR` or `eu` would match half the tree and mean nothing: the core is
    // required to know those exist.
    expect(needles).toContain('canary-minimal');
    expect(needles.some((value) => ['EUR', 'eu', 'FR', 'fr-FR'].includes(value))).toBe(false);
  });

  it('finds a client value written into a core file', () => {
    const leaks = findClientLeaks(shops(), [
      { path: 'src/features/orders/db.ts', text: 'if (slug === "canary-minimal") { skipVat(); }' },
    ]);
    expect(leaks).toEqual([{ path: 'src/features/orders/db.ts', slug: 'canary-minimal', value: 'canary-minimal' }]);
  });

  it('leaves a core file that names no shop alone', () => {
    expect(findClientLeaks(shops(), [{ path: 'src/config.ts', text: 'export const currency = "EUR";' }])).toEqual([]);
  });

  // The gate is only as good as its scope, and its scope is the real tree.
  it('passes over this repository', () => {
    const report = JSON.parse(execFileSync('node', ['scripts/check-manifest.mjs', '--json'], { cwd: root, encoding: 'utf8' }));
    expect(report.coreNeutrality).toEqual({ ok: true, findings: [] });
  });
});
