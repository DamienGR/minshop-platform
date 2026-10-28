/**
 * The private fleet registry (plan §3.1) — which shops the agency operates.
 *
 * A fleet is not discoverable. Two shops are two repositories on two Cloudflare
 * accounts (ADR 0001), and nothing on a laptop says which directories are the
 * ones under contract: scanning for `client/client.yaml` would sweep in an
 * abandoned experiment, a colleague's clone and the shop of a customer who left
 * — and `fleet upgrade` writes. So the list is DECLARED, in one file, and
 * anything not in it is not in the fleet.
 *
 * JSON, not YAML, and that is a decision rather than a slip: the manifest
 * reader (`scripts/manifest-yaml.mjs`) refuses sequences on purpose, and a
 * registry is a list. Adding sequences to it would loosen the parser that reads
 * the file whose values become Cloudflare resource names, to serve a file the
 * merchant never sees. `JSON.parse` costs nothing and fails on a trailing
 * comma, which is the whole class of error a hand-edited list produces.
 *
 * The registry holds NO secret and no account id: it names shops, their
 * checkouts and the core they take versions from. Everything else is already in
 * each shop's own manifest, and a second copy would be a second thing to keep
 * in step.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { inputError, preconditionError } from './errors.mjs';

/** Where the registry lives, when nothing names it. */
export const FLEET_FILE = 'fleet.json';

/** The shape this version of shopctl reads. Bumped when the file's meaning
 *  changes, never when a field is added — an older CLI must be able to say
 *  "this registry is newer than me" instead of misreading it. */
export const FLEET_SCHEMA_VERSION = 1;

/** An example, printed by the error that says the file is missing. Shown rather
 *  than described: the first registry an agency writes is a copy of this. */
export const FLEET_EXAMPLE = `{
  "schemaVersion": ${FLEET_SCHEMA_VERSION},
  "core": { "repository": "git@github.com:agence/socle.git" },
  "shops": [
    { "slug": "premiere-boutique", "path": "shop-premiere-boutique" },
    { "slug": "seconde-boutique", "path": "shop-seconde-boutique" }
  ]
}`;

/**
 * Find the registry: the path given, or `fleet.json` walking up from `cwd`.
 *
 * Walking up is what makes `shopctl fleet status` work from inside one of the
 * shops rather than only from the directory that happens to hold them all. It
 * stops at the filesystem root, and it never crosses into a home directory it
 * was not started from, because it only ever goes UP from where it was run.
 */
export function findRegistry(cwd = process.cwd(), explicit = undefined) {
  if (explicit) {
    const path = isAbsolute(String(explicit)) ? String(explicit) : resolve(cwd, String(explicit));
    if (!existsSync(path)) throw inputError(`aucun registre de flotte à ${path}.`);
    return path;
  }
  const found = nearestRegistry(cwd);
  if (found) return found;
  throw preconditionError(
    `aucun ${FLEET_FILE} trouvé depuis ${cwd}.`,
    `Le registre de flotte est déclaré, jamais deviné : une boutique que personne n'a inscrite n'est pas dans la flotte. Écrivez ${FLEET_FILE} à côté des boutiques, ou passez --registry :\n\n${FLEET_EXAMPLE}`,
  );
}

/** `fleet.json` walking up from `cwd`, or null: for a command that asks the
 *  fleet a question when there is one, and has nothing to ask otherwise. */
export function nearestRegistry(cwd = process.cwd()) {
  let directory = resolve(cwd);
  for (;;) {
    const candidate = resolve(directory, FLEET_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

/**
 * Read and check one registry.
 *
 * Every path is resolved against the registry's OWN directory, not the working
 * directory: `shopctl fleet upgrade` must do the same thing whether it is run
 * from the workspace or from inside one of its shops.
 *
 * @returns {{ file: string, root: string, schemaVersion: number, core: { repository: string|null },
 *            shops: Array<{ slug: string, path: string, root: string, exists: boolean, isShop: boolean }> }}
 */
export function readRegistry(file) {
  let document;
  try {
    document = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw inputError(`${file} n'est pas un JSON lisible : ${error.message}`, `Attendu :\n\n${FLEET_EXAMPLE}`);
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw inputError(`${file} doit contenir un objet.`, `Attendu :\n\n${FLEET_EXAMPLE}`);
  }
  const version = document.schemaVersion;
  if (version !== FLEET_SCHEMA_VERSION) {
    throw inputError(
      `${file} déclare schemaVersion ${JSON.stringify(version)} ; cette version de shopctl lit ${FLEET_SCHEMA_VERSION}.`,
      version > FLEET_SCHEMA_VERSION
        ? 'Le registre est plus récent que la CLI : mettez le socle à niveau avant de piloter cette flotte.'
        : `Attendu :\n\n${FLEET_EXAMPLE}`,
    );
  }
  if (!Array.isArray(document.shops) || document.shops.length === 0) {
    throw inputError(`${file} ne déclare aucune boutique.`, `\`shops\` est une liste non vide :\n\n${FLEET_EXAMPLE}`);
  }

  const root = dirname(file);
  const seen = new Map();
  const shops = document.shops.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw inputError(`${file}: shops[${index}] doit être un objet { "slug", "path" }.`);
    }
    const slug = String(entry.slug ?? '').trim();
    const path = String(entry.path ?? '').trim();
    if (!slug || !path) throw inputError(`${file}: shops[${index}] doit porter un slug et un path.`);
    // Two entries for one shop would upgrade it twice and report it twice, and
    // the second report would describe a tree the first one had already moved.
    if (seen.has(slug)) throw inputError(`${file}: la boutique « ${slug} » est déclarée deux fois.`);
    seen.set(slug, index);
    const shopRoot = isAbsolute(path) ? path : resolve(root, path);
    return {
      slug,
      path,
      root: shopRoot,
      exists: existsSync(shopRoot),
      isShop: existsSync(resolve(shopRoot, 'client/client.yaml')),
    };
  });

  const core = document.core ?? {};
  if (core !== null && typeof core === 'object' && !Array.isArray(core)) {
    return {
      file,
      root,
      schemaVersion: version,
      core: { repository: core.repository ? String(core.repository) : null },
      shops,
    };
  }
  throw inputError(`${file}: \`core\` doit être un objet { "repository" }.`);
}

/** The registry a command operates on. */
export function loadFleet(cwd = process.cwd(), explicit = undefined) {
  return readRegistry(findRegistry(cwd, explicit));
}

/** Keep only the shops `--only` names, and refuse a name the registry has never
 *  heard of — a typo there would silently upgrade nothing and report success. */
export function selectShops(fleet, only) {
  if (!only) return fleet.shops;
  const wanted = String(only)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const known = new Set(fleet.shops.map((shop) => shop.slug));
  const unknown = wanted.filter((slug) => !known.has(slug));
  if (unknown.length > 0) {
    throw inputError(
      `${unknown.join(', ')} : ${unknown.length > 1 ? 'boutiques inconnues' : 'boutique inconnue'} de ${fleet.file}.`,
      `Flotte : ${[...known].join(', ')}.`,
    );
  }
  return fleet.shops.filter((shop) => wanted.includes(shop.slug));
}
