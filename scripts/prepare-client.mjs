#!/usr/bin/env node
/**
 * Turn a client manifest into the build inputs for that shop.
 *
 * Two things a build needs that live in the manifest: the Wrangler
 * configuration (every resource name) and the theme selection. Both are
 * DERIVED here rather than committed per shop, which is what the exit criterion
 * of jalon 1 actually asks for — two shops building from one core with no
 * client value written into it.
 *
 * The Wrangler file is rendered from wrangler.template.jsonc, the same template
 * provision-cf.sh renders, so a witness build and a real provisioning cannot
 * disagree about which bindings a shop gets.
 *
 * Usage:
 *   node scripts/prepare-client.mjs <slug> [--env <staging|production>]
 *                                   [--database-id <uuid>] [--out <file>] [--json]
 *   node scripts/prepare-client.mjs --list
 *
 * Without --env the unqualified name family is rendered: that is what a witness
 * build, the browser gate and local development use, and none of them reach an
 * account. A deployment always names its environment, because the names it
 * writes to are the ones an operator reads back out of the Cloudflare account.
 *
 * In GitHub Actions it also appends THEME to $GITHUB_ENV, so the matrix job
 * does not have to re-read the manifest in shell.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENVIRONMENTS, clientSlugs, findManifestBySlug, renderWrangler, wranglerSubstitutions } from './manifest.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const root = process.cwd();
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const VALUE_FLAGS = ['--database-id', '--out', '--env'];

const TEMPLATE = 'wrangler.template.jsonc';
const OUTPUT = 'wrangler.jsonc';
if (args.includes('--list')) {
  console.log(JSON.stringify(clientSlugs()));
  process.exit(0);
}

const slug = args.find((arg, index) => !arg.startsWith('--') && !VALUE_FLAGS.includes(args[index - 1]));
if (!slug) {
  console.error(`Usage: node scripts/prepare-client.mjs <slug>\nKnown shops: ${clientSlugs().join(', ') || '(none)'}`);
  process.exit(2);
}

const found = findManifestBySlug(slug, { root });
if (!found) {
  console.error(`No manifest for "${slug}". Known shops: ${clientSlugs().join(', ') || '(none)'}`);
  process.exit(1);
}
if (found.errors.length > 0) {
  console.error(`✗ ${found.file} is not valid; refusing to build a shop from it:`);
  for (const error of found.errors) console.error(`    ${error.path} ${error.message}`);
  process.exit(1);
}

const manifest = found.manifest;
const env = flag('--env') ?? null;
if (env !== null && !ENVIRONMENTS.includes(env)) {
  console.error(`Unknown environment "${env}". Expected one of: ${ENVIRONMENTS.join(', ')}.`);
  process.exit(2);
}
const substitutions = wranglerSubstitutions(manifest, { databaseId: flag('--database-id'), env });
const rendered = renderWrangler(readFileSync(resolve(root, TEMPLATE), 'utf8'), substitutions);
const output = flag('--out') ?? OUTPUT;
writeFileSync(resolve(root, output), rendered);

if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `THEME=${manifest.theme.id}\n`);

if (asJson) {
  console.log(JSON.stringify({ slug, file: found.file, env, theme: manifest.theme.id, output, substitutions }, null, 2));
} else {
  console.log(`Prepared ${slug} from ${found.file}${env ? ` for ${env}` : ''}`);
  console.log(`  ${output} → ${substitutions.__NAME__}, ${substitutions.__DB_NAME__}, ${substitutions.__BUCKET__}, ${substitutions.__FILES_BUCKET__}`);
  console.log(`  theme  → ${manifest.theme.id}${process.env.GITHUB_ENV ? ' (exported as THEME)' : `  (export THEME=${manifest.theme.id})`}`);
}
