#!/usr/bin/env node
/**
 * The manifest gate: every client manifest in this tree is valid, no two shops
 * claim the same resource, and the published JSON Schema still matches the spec
 * it is generated from.
 *
 * Runs in the core repository (over the witness fixtures) and in a generated
 * shop (over its own `client/client.yaml`, plus whichever fixtures it kept).
 * Same command either way: `npm run config:validate`, which is also what
 * `shopctl config validate` will call.
 *
 * Usage:
 *   node scripts/check-manifest.mjs [--json] [--write]
 *
 *   --write  regenerate schemas/client-<n>.schema.json instead of failing on
 *            drift. The generated file is committed so editors can validate the
 *            manifest without running this repository's tooling.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCHEMA_VERSION, manifestJsonSchema } from './manifest-schema.mjs';
import {
  coreVersion,
  detectFleetCollisions,
  discoverManifests,
  findClientLeaks,
  isShopRepository,
  loadManifest,
  resourceNames,
} from './manifest.mjs';
import { classifyPath } from './path-ownership.mjs';
import { CONFIG_FILE, resolveConfiguredTheme } from './themes.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const write = args.includes('--write');
const root = process.cwd();

export const SCHEMA_FILE = `schemas/client-${SCHEMA_VERSION}.schema.json`;

/** Serialized exactly as `--write` produces it, so the drift check compares
 *  bytes and not a re-parse that would hide a formatting difference. */
function renderSchema() {
  return `${JSON.stringify(manifestJsonSchema(), null, 2)}\n`;
}

function checkSchemaFile() {
  const path = resolve(root, SCHEMA_FILE);
  const expected = renderSchema();

  if (write) {
    mkdirSync(resolve(root, 'schemas'), { recursive: true });
    writeFileSync(path, expected);
    return { ok: true, wrote: true };
  }

  if (!existsSync(path)) {
    return { ok: false, message: `${SCHEMA_FILE} is missing. Run \`npm run config:validate -- --write\` to generate it.` };
  }
  if (readFileSync(path, 'utf8') !== expected) {
    return {
      ok: false,
      message: `${SCHEMA_FILE} no longer matches scripts/manifest-schema.mjs. Editors validate manifests against that file, so a stale copy advertises fields the validator rejects. Run \`npm run config:validate -- --write\`.`,
    };
  }
  return { ok: true };
}

/**
 * Trees exempt from the client-neutrality scan (findClientLeaks).
 *
 * The witness manifests obviously name themselves; the certification suite and
 * the documentation name them on purpose; a rendered wrangler.jsonc names the
 * shop it was rendered for, which is its whole job (and is generated, not core).
 * What is left is the business core, where a customer's name has no business
 * appearing.
 */
const NEUTRALITY_EXEMPT = [/^docs\//, /^test\//];

/** Core-owned text files, read once, for findClientLeaks(). Binary assets and
 *  the exempt trees never reach it. */
function coreText() {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const files = [];
  for (const path of tracked) {
    if (classifyPath(path)?.owner !== 'core') continue;
    if (NEUTRALITY_EXEMPT.some((pattern) => pattern.test(path))) continue;
    try {
      const buffer = readFileSync(resolve(root, path));
      if (buffer.includes(0)) continue; // binary asset
      files.push({ path, text: buffer.toString('utf8') });
    } catch {
      // A tracked path that cannot be read is the working tree's problem, not
      // this gate's; check:paths reports on the tree itself.
    }
  }
  return files;
}

/**
 * In a shop, the manifest is the authority on the design and theme.config.json
 * is the copy the build resolver reads. Two files naming the theme is one file
 * too many; the gate is what makes the second one a derivation rather than a
 * second opinion.
 */
function checkThemeSelection(entries) {
  if (!isShopRepository(root)) return null;
  const own = entries.find(({ file }) => file === 'client/client.yaml');
  if (!own) return null;
  let configured;
  try {
    configured = resolveConfiguredTheme(root).id;
  } catch (error) {
    return { ok: false, message: error.message };
  }
  if (configured !== own.manifest.theme.id) {
    return {
      ok: false,
      message: `${CONFIG_FILE} selects "${configured}" but client/client.yaml declares theme.id "${own.manifest.theme.id}". The build follows ${CONFIG_FILE}, so the shop would deploy a design its manifest does not describe.`,
    };
  }
  return { ok: true, theme: configured };
}

const core = coreVersion(root);
const files = discoverManifests(root);
const loaded = files.map((file) => loadManifest(file, { root, core }));
const valid = loaded.filter((entry) => entry.errors.length === 0);
const collisions = detectFleetCollisions(valid);
const schema = checkSchemaFile();
const leaks = findClientLeaks(valid, coreText());
const themeSelection = checkThemeSelection(valid);

const failed = loaded.filter((entry) => entry.errors.length > 0);
const ok =
  failed.length === 0 && collisions.length === 0 && schema.ok && leaks.length === 0 && (themeSelection?.ok ?? true);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok,
        core,
        repository: isShopRepository(root) ? 'shop' : 'core',
        schemaVersion: SCHEMA_VERSION,
        schemaFile: schema,
        manifests: loaded.map(({ file, manifest, errors }) => ({
          file,
          slug: manifest?.client?.slug ?? null,
          theme: manifest?.theme?.id ?? null,
          resources: errors.length === 0 ? resourceNames(manifest) : null,
          errors,
        })),
        collisions,
        coreNeutrality: { ok: leaks.length === 0, findings: leaks },
        themeSelection,
      },
      null,
      2,
    ),
  );
  process.exit(ok ? 0 : 1);
}

if (files.length === 0) {
  console.error('No client manifest found. The core repository carries the witness fixtures under test/fixtures/clients/.');
  process.exit(1);
}

for (const { file, manifest, errors } of loaded) {
  if (errors.length === 0) {
    const names = resourceNames(manifest);
    console.log(`✓ ${file} — ${manifest.client.slug} (theme ${manifest.theme.id}, core ${manifest.coreVersion}) → ${names.worker}`);
    continue;
  }
  console.error(`✗ ${file}`);
  for (const error of errors) {
    console.error(`    ${error.path} ${error.message}${error.rule ? ` [${error.rule}]` : ''}`);
  }
}

for (const { kind, value, files: claimants } of collisions) {
  console.error(`✗ two shops claim the same ${kind} "${value}": ${claimants.join(', ')}`);
  console.error('    Nothing at runtime keeps their data apart (ADR 0001); the names have to.');
}

for (const leak of leaks) {
  console.error(`✗ ${leak.path} names the shop "${leak.slug}" ("${leak.value}")`);
  console.error('    A core file that knows a customer is a condition the third shop discovers in production. Move the value into the manifest.');
}

if (leaks.length === 0) console.log('✓ no client value written into a core file');

if (themeSelection && !themeSelection.ok) console.error(`✗ ${themeSelection.message}`);
else if (themeSelection) console.log(`✓ ${CONFIG_FILE} follows the manifest (${themeSelection.theme})`);

if (schema.wrote) console.log(`✓ ${SCHEMA_FILE} regenerated`);
else if (!schema.ok) console.error(`✗ ${schema.message}`);
else console.log(`✓ ${SCHEMA_FILE} matches the spec`);

if (!ok) process.exit(1);
console.log(`Manifests valid against core ${core}, no shared resource identifiers.`);
