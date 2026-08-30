/**
 * Reading client manifests off disk, and the checks that need more than the
 * file itself: does the theme exist in this tree, and does the fleet agree that
 * every resource name belongs to exactly one shop.
 *
 * manifest-schema.mjs decides whether ONE manifest is well-formed.
 * This module decides whether it fits the tree and the fleet around it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseManifestYaml } from './manifest-yaml.mjs';
import { RESOURCE_PREFIX, validateManifest } from './manifest-schema.mjs';
import { THEMES_DIR } from './themes.mjs';

/** Where a real shop keeps its manifest. Absent in the core repository —
 *  which is precisely how the tooling tells a shop clone from the core. */
export const CLIENT_MANIFEST = 'client/client.yaml';

/** The witness shops (plan §2.3). They live under test/ because in the core
 *  repository they are fixtures, not deployments: nothing provisions them. */
export const WITNESS_CLIENTS_DIR = 'test/fixtures/clients';

/** True when this tree is a generated shop rather than the core itself. */
export function isShopRepository(root = process.cwd()) {
  return existsSync(resolve(root, CLIENT_MANIFEST));
}

/** The core's own version, from package.json — the value a manifest's
 *  `coreVersion` is checked against. */
export function coreVersion(root = process.cwd()) {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  return pkg.version;
}

/**
 * Every Cloudflare resource of a shop, derived from one name.
 *
 * Derivation, not configuration. Letting a manifest name its D1 database
 * independently of its Worker buys nothing and costs the property the operator
 * relies on: that `minshop-pilot-fr*` is the complete footprint of one shop,
 * and that destroy-cf.sh removes all of it (scripts/destroy-cf.sh keys on the
 * same suffixes).
 */
export function resourceNames(manifest) {
  const worker = manifest.cloudflare.workerName;
  return {
    worker,
    database: `${worker}-db`,
    images: `${worker}-images`,
    files: `${worker}-files`,
    sessions: `${worker}-session`,
  };
}

/** Every manifest in this tree: the shop's own, plus the witness fixtures. */
export function discoverManifests(root = process.cwd()) {
  const files = [];
  if (isShopRepository(root)) files.push(CLIENT_MANIFEST);

  const dir = resolve(root, WITNESS_CLIENTS_DIR);
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      const candidate = join(dir, name, 'client.yaml');
      if (statSync(join(dir, name)).isDirectory() && existsSync(candidate)) {
        files.push(relative(root, candidate).split('\\').join('/'));
      }
    }
  }
  return files;
}

/**
 * Read and fully check one manifest.
 *
 * Never throws for a bad file: a syntax error is an error entry like any
 * other, so `config validate` can report every manifest in one pass instead of
 * dying on the first one.
 *
 * @returns {{ file: string, manifest: object|null, errors: Array<{ path: string, message: string, rule?: string }> }}
 */
export function loadManifest(file, { root = process.cwd(), core = coreVersion(root), checkTheme = true } = {}) {
  const path = resolve(root, file);
  let manifest;
  try {
    manifest = parseManifestYaml(readFileSync(path, 'utf8'), { file });
  } catch (error) {
    return { file, manifest: null, errors: [{ path: '(file)', message: error.message }] };
  }

  const { errors } = validateManifest(manifest, { coreVersion: core });
  if (errors.length === 0 && checkTheme) {
    const themeDir = resolve(root, THEMES_DIR, manifest.theme.id);
    if (!existsSync(themeDir)) {
      errors.push({
        path: 'theme.id',
        rule: 'theme-exists',
        message: `names "${manifest.theme.id}", which has no directory at ${THEMES_DIR}/${manifest.theme.id}. A shop whose theme is missing builds the wrong design or nothing at all.`,
      });
    }
  }

  // The parsed object is returned even when invalid: a report that can name
  // the shop is more useful than one that can only name the file.
  return { file, manifest, errors };
}

/**
 * Names two shops must never share.
 *
 * Isolation is a provisioning property (ADR 0001): nothing at runtime prevents
 * two manifests from pointing at the same D1 database, and if they ever did,
 * one shop's orders would land in another's. There is no query-level guard to
 * fall back on, so the guard has to be here, on the names, before provisioning
 * reads them.
 */
export function fleetIdentifiers(manifest) {
  const names = resourceNames(manifest);
  return [
    { kind: 'slug', value: manifest.client.slug },
    { kind: 'worker', value: names.worker },
    { kind: 'D1 database', value: names.database },
    { kind: 'images bucket', value: names.images },
    { kind: 'files bucket', value: names.files },
    { kind: 'sessions KV', value: names.sessions },
    { kind: 'production domain', value: manifest.cloudflare.productionDomain },
  ];
}

/**
 * Identifiers claimed by more than one manifest.
 *
 * @param {Array<{ file: string, manifest: object }>} entries valid manifests only
 * @returns {Array<{ kind: string, value: string, files: string[] }>}
 */
export function detectFleetCollisions(entries) {
  const claims = new Map();
  for (const { file, manifest } of entries) {
    for (const { kind, value } of fleetIdentifiers(manifest)) {
      const key = `${kind}\u0000${value}`;
      if (!claims.has(key)) claims.set(key, { kind, value, files: [] });
      claims.get(key).files.push(file);
    }
  }
  return [...claims.values()].filter((claim) => claim.files.length > 1);
}

/** The `__…__` substitutions wrangler.template.jsonc expects for a shop.
 *  The database id is not a manifest value — provisioning learns it from
 *  Cloudflare — so callers pass the id they have, or the all-zero placeholder
 *  for a build that never talks to an account. */
export function wranglerSubstitutions(manifest, { databaseId = '00000000-0000-0000-0000-000000000000' } = {}) {
  const names = resourceNames(manifest);
  return {
    __NAME__: names.worker,
    __DB_NAME__: names.database,
    __DB_ID__: databaseId,
    __BUCKET__: names.images,
    __FILES_BUCKET__: names.files,
  };
}

/** Resolve a shop by slug among the manifests of this tree. */
export function findManifestBySlug(slug, { root = process.cwd() } = {}) {
  for (const file of discoverManifests(root)) {
    const loaded = loadManifest(file, { root });
    if (loaded.manifest?.client?.slug === slug) return loaded;
  }
  return null;
}

export { RESOURCE_PREFIX };
