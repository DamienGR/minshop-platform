/**
 * Publishing a core version, and refusing to publish a broken one.
 *
 * A shop is created from an immutable `v<semver>` tag and upgraded by merging
 * the next one (ADR 0003). That makes a tag the unit of everything downstream:
 * `shopctl new --core`, `shopctl core upgrade --to`, the fleet report. So a tag
 * has to mean one exact thing, and this module is what keeps it meaning it.
 *
 * A core version is written in three places, and all three must agree:
 * `package.json`, which is what the manifest gate checks a shop's `coreVersion`
 * against; the witness manifests under `test/fixtures/clients/`, which that same
 * gate validates on every commit; and `docs/migrations/v<version>.md`, which
 * says what an upgrade to this version asks of a shop that takes it.
 *
 * The witness fixtures are not a formality. Bumping `package.json` alone turns
 * `npm run config:validate` red on the next commit — which is how this check
 * was found: from a shop that had merged a version whose fixtures still
 * declared the old one, and whose own gates then refused it.
 *
 * Three things it refuses outright:
 *
 *  - **moving a published tag.** A published tag is never moved or deleted
 *    (ADR 0003); a faulty version is corrected by a new one. A tag that moved
 *    would silently change what a shop created last month was built from;
 *  - **rewriting a published migration.** A database that already ran it will
 *    not run it again (ADR 0006), so an edited migration leaves the fleet on
 *    schemas nobody can reproduce;
 *  - **a destructive migration.** Dropping or renaming in the same version that
 *    stops using the column breaks the PREVIOUS application version, which is
 *    the version a rollback goes back to.
 *
 * Two questions, asked at two moments. CONSISTENCY — do the three places agree,
 * are the notes there, are the migrations additive — is asked on every commit
 * by `npm run verify`, and stays green between releases. Whether the TAG IS
 * FREE is only a question at the moment of tagging: a tree that has just
 * published v0.1.0 is still perfectly consistent, and a gate that went red on
 * every commit until someone bumped the version would be disabled within the
 * week.
 *
 * This module decides; `scripts/check-release.mjs` is what CI and an operator
 * run. Same split as path-ownership.mjs and check-paths.mjs, for the same
 * reason: a module that prints and exits cannot be tested.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const WITNESS_DIR = 'test/fixtures/clients';
export const ROOT_DIR = ROOT;
export const NOTES_DIR = 'docs/migrations';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Git, in the tree being examined — never in "the repository this file happens
 *  to live in". The checks take a root so a test can point them at a tree of
 *  three files, and a gate that ignored it would answer about this repository
 *  instead. */
function git(args, cwd = ROOT) {
  try {
    // stderr is discarded rather than inherited: git's "not a repository" is an
    // ANSWER here — a tree with no history has no previous tag — and printing
    // it would make a passing run look broken.
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const lines = (text) =>
  String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** The witness manifests, relative to the root. */
function witnessManifests(root = ROOT) {
  const dir = join(root, WITNESS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((name) => `${WITNESS_DIR}/${name}/client.yaml`)
    .filter((file) => existsSync(join(root, file)));
}

/**
 * Every file that states the core version, and what it currently says.
 *
 * One list, used by the check AND by `--set`, so a new place to write the
 * version can never be added to one and forgotten in the other.
 */
export function versionLocations(root = ROOT) {
  const found = [
    {
      file: 'package.json',
      value: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
      set: (text, version) => text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`),
    },
  ];
  for (const file of witnessManifests(root)) {
    const text = readFileSync(join(root, file), 'utf8');
    found.push({
      file,
      value: text.match(/^coreVersion:[ \t]*(\S+)/m)?.[1] ?? null,
      set: (content, version) => content.replace(/^coreVersion:[ \t]*.*$/m, `coreVersion: ${version}`),
    });
  }
  return found;
}

/**
 * Statements a migration must not contain (ADR 0006).
 *
 * Additive only: a shop on the previous version must keep working on the new
 * schema, which is what makes a Worker rollback safe. Dropping or renaming
 * takes at least two versions — one that stops reading the column, a later one
 * that removes it — so a single migration doing both is refused here rather
 * than discovered by the shop that rolled back.
 *
 * Comments are stripped first: `-- rename the column` is a sentence, not a
 * statement, and a gate that cannot tell them apart is a gate people route
 * around by rewording their comments.
 *
 * @returns {string[]} the offending statements, verbatim
 */
export function destructiveStatements(sql) {
  const code = String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
  const patterns = [
    /\bDROP\s+TABLE\b[^;]*/gi,
    /\bALTER\s+TABLE\b[^;]*\bDROP\s+COLUMN\b[^;]*/gi,
    /\bALTER\s+TABLE\b[^;]*\bRENAME\b[^;]*/gi,
  ];
  return patterns.flatMap((pattern) => [...code.matchAll(pattern)].map((match) => match[0].replace(/\s+/g, ' ').trim()));
}

/** Migration files ADDED between two refs. */
function addedMigrations(from, root, to = 'HEAD') {
  if (!from) return [];
  return lines(git(['diff', '--name-only', '--diff-filter=A', from, to, '--', 'migrations/'], root));
}

/** Migration files changed or deleted between two refs — forbidden by ADR 0006. */
function rewrittenMigrations(from, root, to = 'HEAD') {
  if (!from) return [];
  return lines(git(['diff', '--name-only', '--diff-filter=MDR', from, to, '--', 'migrations/'], root));
}

/** The newest core tag this checkout knows, or null. */
function lastTag(root) {
  const tags = lines(git(['tag', '--list'], root))
    .filter((tag) => SEMVER.test(tag.replace(/^v/, '')) && tag.startsWith('v'))
    .sort((a, b) => {
      const [aMajor, aMinor, aPatch] = a.slice(1).split('.').map(Number);
      const [bMajor, bMinor, bPatch] = b.slice(1).split('.').map(Number);
      return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
    });
  return tags.at(-1) ?? null;
}

/**
 * Is this tree publishable as `v<version>`?
 *
 * @returns {{ ok: boolean, version: string, tag: string, checks: Array<{ check: string, ok: boolean, message: string }> }}
 */
export function releaseFindings(root = ROOT, { publish = false } = {}) {
  const locations = versionLocations(root);
  const version = locations[0].value;
  const tag = `v${version}`;
  const checks = [];

  checks.push({
    check: 'version',
    ok: SEMVER.test(String(version)),
    message: SEMVER.test(String(version))
      ? `package.json déclare ${version}`
      : `package.json déclare « ${version} », qui n'est pas un <major>.<minor>.<patch>`,
  });

  const disagreeing = locations.filter((entry) => entry.value !== version);
  checks.push({
    check: 'accord des manifestes témoins',
    ok: disagreeing.length === 0,
    message:
      disagreeing.length === 0
        ? `${locations.length - 1} manifeste${locations.length > 2 ? 's' : ''} témoin${locations.length > 2 ? 's' : ''} sur ${version}`
        : `${disagreeing.map((entry) => `${entry.file} déclare ${entry.value}`).join(' ; ')} — la porte des manifestes refusera le prochain commit`,
  });

  const notes = `${NOTES_DIR}/${tag}.md`;
  const hasNotes = existsSync(join(root, notes)) && readFileSync(join(root, notes), 'utf8').trim().length > 0;
  checks.push({
    check: 'notes de migration',
    ok: hasNotes,
    message: hasNotes ? notes : `${notes} manque ou est vide — une version qu'aucune note n'accompagne se met à niveau à l'aveugle`,
  });

  if (publish) {
    const published = lines(git(['tag', '--list', tag], root));
    checks.push({
      check: 'tag non publié',
      ok: published.length === 0,
      message:
        published.length === 0
          ? `${tag} reste à créer`
          : `${tag} existe déjà : un tag publié ne se déplace pas (ADR 0003), la correction est une version suivante`,
    });
  }

  const previous = lastTag(root);
  const rewritten = rewrittenMigrations(previous, root);
  checks.push({
    check: 'migrations publiées intactes',
    ok: rewritten.length === 0,
    message:
      rewritten.length === 0
        ? previous
          ? `aucune migration réécrite depuis ${previous}`
          : 'aucune version antérieure à comparer'
        : `${rewritten.join(', ')} réécrite${rewritten.length > 1 ? 's' : ''} depuis ${previous} — interdit par l'ADR 0006`,
  });

  const destructive = addedMigrations(previous, root)
    .filter((file) => existsSync(join(root, file)))
    .flatMap((file) => destructiveStatements(readFileSync(join(root, file), 'utf8')).map((statement) => `${file}: ${statement}`));
  checks.push({
    check: 'migrations additives',
    ok: destructive.length === 0,
    message:
      destructive.length === 0
        ? previous
          ? `les migrations ajoutées depuis ${previous} n'enlèvent rien`
          : 'aucune version antérieure à comparer'
        : `${destructive.slice(0, 3).join(' ; ')} — une suppression ou un renommage casse la version applicative précédente (ADR 0006)`,
  });

  return { ok: checks.every((check) => check.ok), version, tag, previous, notes, checks };
}

/** Write `version` everywhere it belongs, and stub its notes. */

export function setVersion(version, root = ROOT) {
  if (!SEMVER.test(version)) throw new Error(`« ${version} » n'est pas un <major>.<minor>.<patch>.`);
  const written = [];
  for (const entry of versionLocations(root)) {
    const path = join(root, entry.file);
    const before = readFileSync(path, 'utf8');
    const after = entry.set(before, version);
    if (after !== before) {
      writeFileSync(path, after);
      written.push(entry.file);
    }
  }
  const notes = join(root, NOTES_DIR, `v${version}.md`);
  if (!existsSync(notes)) {
    mkdirSync(join(root, NOTES_DIR), { recursive: true });
    writeFileSync(notes, notesTemplate(version));
    written.push(`${NOTES_DIR}/v${version}.md`);
  }
  return written;
}

/** The skeleton a version's notes start from. Sections rather than prose: an
 *  empty section is a question someone has to answer, a blank file is not. */
export function notesTemplate(version) {
  return `# Socle v${version}

<!-- Ce que cette version demande à une boutique qui la prend. Lu par
     \`shopctl core upgrade\` et repris dans la pull request de mise à niveau. -->

## Ce qui change

- …

## Migrations

- aucune / \`migrations/00XX_….sql\`, additive (ADR 0006)

## À faire dans la boutique

- rien / …

## Compatibilité

- l'ancien Worker reste fonctionnel sur le nouveau schéma ; un rollback
  applicatif reste possible.
`;
}
