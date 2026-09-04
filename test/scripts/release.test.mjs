import { describe, expect, it } from 'vitest';

// .mjs like its neighbours: tsconfig pins `types` to the Cloudflare types, so
// node builtins have no declarations in a .ts file here.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnSync } from 'node:child_process';

import { destructiveStatements, notesTemplate, releaseFindings, setVersion, tagIsTaken, versionLocations } from '../../scripts/release.mjs';

/** A tree with the three places a core version is written, and nothing else.
 *  The gate reads files; it does not need five hundred of them. */
function tree({ version = '0.1.0', witnesses = { 'pilot-witness': '0.1.0' }, notes = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'release-'));
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'minshop', version }, null, 2)}\n`);
  for (const [name, declared] of Object.entries(witnesses)) {
    mkdirSync(join(root, 'test/fixtures/clients', name), { recursive: true });
    writeFileSync(
      join(root, 'test/fixtures/clients', name, 'client.yaml'),
      `schemaVersion: 1\ncoreVersion: ${declared}\nclient:\n  slug: ${name}\n`,
    );
  }
  mkdirSync(join(root, 'docs/migrations'), { recursive: true });
  if (notes) writeFileSync(join(root, 'docs/migrations', `v${version}.md`), `# Socle v${version}\n\nRien à faire.\n`);
  return root;
}

const check = (report, name) => report.checks.find((entry) => entry.check === name);

describe('where a core version is written', () => {
  // Bumping package.json alone is the mistake this list exists to prevent: the
  // manifest gate compares every manifest in the tree to the core's version, so
  // a witness left behind turns the next commit red — and, worse, turns red the
  // shop that merged the tag.
  it('is package.json and every witness manifest', () => {
    const root = tree({ witnesses: { alpha: '0.1.0', beta: '0.1.0' } });
    expect(versionLocations(root).map((entry) => entry.file)).toEqual([
      'package.json',
      'test/fixtures/clients/alpha/client.yaml',
      'test/fixtures/clients/beta/client.yaml',
    ]);
  });

  it('is written in one pass by --set, notes included', () => {
    const root = tree({ witnesses: { alpha: '0.1.0', beta: '0.1.0' } });
    const written = setVersion('0.2.0', root);
    expect(written).toContain('package.json');
    expect(written).toContain('docs/migrations/v0.2.0.md');
    expect(versionLocations(root).every((entry) => entry.value === '0.2.0')).toBe(true);
    expect(readFileSync(join(root, 'docs/migrations/v0.2.0.md'), 'utf8')).toBe(notesTemplate('0.2.0'));
  });

  it('refuses a version that is not a semver', () => {
    expect(() => setVersion('1.2', tree())).toThrow(/major/);
  });
});

describe('the release gate', () => {
  it('passes a tree whose three places agree', () => {
    const report = releaseFindings(tree());
    expect(report.ok).toBe(true);
    expect(report.tag).toBe('v0.1.0');
  });

  it('fails a witness left on the previous version, and names it', () => {
    const report = releaseFindings(tree({ version: '0.2.0', witnesses: { alpha: '0.1.0' }, notes: true }));
    expect(report.ok).toBe(false);
    expect(check(report, 'accord des manifestes témoins').message).toContain('alpha/client.yaml déclare 0.1.0');
  });

  // A version nobody documented is a version a shop upgrades to blind: the
  // notes are what `shopctl core upgrade` prints and what the pull request
  // carries.
  it('fails a version with no migration notes', () => {
    const report = releaseFindings(tree({ notes: false }));
    expect(report.ok).toBe(false);
    expect(check(report, 'notes de migration').message).toContain('docs/migrations/v0.1.0.md');
  });

  it('fails a version that is not a semver', () => {
    const report = releaseFindings(tree({ version: 'next' }));
    expect(check(report, 'version').ok).toBe(false);
  });
});

describe('what a migration may not do', () => {
  // ADR 0006: additive only. The property that matters is not tidiness — it is
  // that the PREVIOUS application version keeps working on the new schema,
  // which is what makes a Worker rollback safe and what lets a shop stay on an
  // older core version.
  it('names a drop, a dropped column and a rename', () => {
    expect(destructiveStatements('DROP TABLE orders;')).toEqual(['DROP TABLE orders']);
    expect(destructiveStatements('ALTER TABLE orders DROP COLUMN legacy;')).toHaveLength(1);
    expect(destructiveStatements('ALTER TABLE orders RENAME COLUMN a TO b;')).toHaveLength(1);
  });

  it('accepts what an additive migration does', () => {
    expect(
      destructiveStatements(
        'CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY);\n' +
          'ALTER TABLE orders ADD COLUMN invoice_id INTEGER;\n' +
          'DROP INDEX IF EXISTS orders_by_date;\n' +
          'CREATE INDEX orders_by_date ON orders(created_at);',
      ),
    ).toEqual([]);
  });

  // A comment is a sentence, not a statement. A gate that cannot tell them
  // apart is a gate people route around by rewording their comments.
  it('reads SQL, not prose', () => {
    expect(destructiveStatements('-- we will DROP TABLE orders in v2\nALTER TABLE orders ADD COLUMN x TEXT;')).toEqual([]);
    expect(destructiveStatements('/* DROP TABLE orders */\nSELECT 1;')).toEqual([]);
  });
});

describe('whether a version number is still free', () => {
  /** A repository with an `origin` that is a local bare one, and a tag on it. */
  function published(tags = []) {
    const remote = mkdtempSync(join(tmpdir(), 'release-remote-'));
    const clone = mkdtempSync(join(tmpdir(), 'release-clone-'));
    const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Minshop Tests', GIT_AUTHOR_EMAIL: 'tests@example.com',
      GIT_COMMITTER_NAME: 'Minshop Tests', GIT_COMMITTER_EMAIL: 'tests@example.com',
    } });
    git(['init', '--bare', '--quiet', remote], undefined);
    git(['init', '--quiet', '--initial-branch=main'], clone);
    writeFileSync(join(clone, 'README.md'), '# t\n');
    git(['add', '-A'], clone);
    git(['commit', '--quiet', '-m', 'premier'], clone);
    git(['remote', 'add', 'origin', remote], clone);
    git(['push', '--quiet', 'origin', 'main'], clone);
    for (const tag of tags) {
      git(['tag', tag], clone);
      git(['push', '--quiet', 'origin', tag], clone);
    }
    // The clone forgets what it pushed: this is the state a hosted checkout
    // hands you — a working tree with no tags — and the state that made the
    // first release run of this repository propose a version that existed.
    for (const tag of tags) git(['tag', '-d', tag], clone);
    return clone;
  }

  it('asks origin, not the clone, and says so', () => {
    const root = published(['v0.1.0']);
    expect(tagIsTaken('v0.1.0', root)).toEqual({ taken: true, source: 'origin' });
    expect(tagIsTaken('v0.2.0', root)).toEqual({ taken: false, source: 'origin' });
  });

  // An empty listing is an ANSWER — "origin does not publish it" — and a failed
  // command is not. Conflating them frees a version number that is taken.
  it('falls back to the clone when there is no origin, and marks the answer local', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-noremote-'));
    spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: root });
    expect(tagIsTaken('v0.1.0', root)).toEqual({ taken: false, source: 'local' });
  });
});
