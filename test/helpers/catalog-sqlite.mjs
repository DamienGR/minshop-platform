/**
 * The catalogue importer, end to end, against a real SQLite engine.
 *
 * `node:sqlite` runs the repository's OWN migrations and then the statements
 * `planImport()` produced, so what the gate checks is the SQL that ships — its
 * quoting, its subselects, its triggers, its uniqueness constraints — and not a
 * mock's opinion of it. A fake store would pass on the day the real INSERT
 * started violating an index.
 *
 * Spawned as a CHILD PROCESS rather than imported by the vitest suite, for one
 * reason: `node:sqlite` needs `--experimental-sqlite` on the lower half of the
 * certified Node line and merely warns on the upper half. A flag on this file's
 * own process line works on both, where a flag on vitest's would have to be
 * threaded through the config and would apply to every unrelated test.
 *
 * Reads one JSON scenario on stdin, writes one JSON result on stdout:
 *
 *   { imports: [{ csv, options, interruptAfter }], currency, queries }
 *      → { runs: [{ summary, refusals, warnings, statements, uploads }], state }
 *
 * Every entry of `imports` runs against the state the previous one left, which
 * is what makes the interesting cases expressible as data: the same file twice
 * is idempotence, a file then an edited copy of it is an update, and
 * `interruptAfter` truncating one run's statements is resumption.
 *
 * `{ csv, runs }` is shorthand for the same file N times.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsvRecords } from '../../shopctl/src/catalog/csv.mjs';
import { buildCatalogue } from '../../shopctl/src/catalog/contract.mjs';
import { resolveCatalogueImages } from '../../shopctl/src/catalog/media.mjs';
import { planImport } from '../../shopctl/src/catalog/plan.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const MIGRATIONS = resolve(ROOT, 'migrations');

/** The same reads store.mjs performs, against the same column list. */
const READS = {
  products: 'SELECT id, sku, slug, name, description, price_cents, currency, stock, active, variant_label, weight_grams, requires_shipping, image_key FROM products',
  variants: 'SELECT id, product_id, sku, label, price_cents, stock, weight_grams, position, active, image_id FROM product_variants',
  categories: 'SELECT id, slug, name FROM categories',
  productCategories: 'SELECT product_id, category_id FROM product_categories',
  productImages: 'SELECT id, product_id, image_key, position FROM product_images',
  media: 'SELECT id, image_key, original_name, mime_type, size_bytes, width, height FROM media',
};

export function migrate(db) {
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(resolve(MIGRATIONS, file), 'utf8'));
  }
}

export function readStore(db) {
  const store = {};
  for (const [name, query] of Object.entries(READS)) store[name] = db.prepare(query).all();
  return store;
}

/** One import against the given database, returning what the CLI would report. */
export function importOnce(db, { csv, currency, options = {}, interruptAfter = null }) {
  const parsed = parseCsvRecords(readFileSync(csv, 'utf8'));
  const built = buildCatalogue(parsed, { currency });
  const resolved = resolveCatalogueImages(built.products, { root: dirname(resolve(csv)) });
  const issues = [...built.issues, ...resolved.issues];
  if (issues.length > 0) return { issues, refusals: [], warnings: [], statements: 0, uploads: [], summary: null };

  const plan = planImport(resolved.products, readStore(db), { currency, ...options });
  if (plan.refusals.length > 0) {
    return { issues: [], refusals: plan.refusals, warnings: plan.warnings, statements: 0, uploads: [], summary: plan.summary };
  }

  // The applier writes objects first, then the file of statements. Truncating
  // the statements is therefore a faithful interruption: the bytes are in the
  // bucket, some of the rows are not.
  const statements = interruptAfter == null ? plan.statements : plan.statements.slice(0, interruptAfter);
  for (const statement of statements) db.exec(statement);

  return {
    issues: [],
    refusals: [],
    warnings: plan.warnings,
    summary: plan.summary,
    statements: plan.statements.length,
    applied: statements.length,
    uploads: plan.uploads.map((upload) => upload.key),
    untouched: plan.untouched,
  };
}

export function runScenario(scenario) {
  const db = new DatabaseSync(scenario.database ?? ':memory:');
  migrate(db);
  if (scenario.seed) for (const statement of scenario.seed) db.exec(statement);

  const imports = scenario.imports
    ?? Array.from({ length: scenario.runs ?? 1 }, (_, index) => ({
      csv: scenario.csv,
      options: scenario.options,
      interruptAfter: index === 0 ? scenario.interruptAfter : null,
    }));

  const runs = [];
  for (const step of imports) {
    runs.push(importOnce(db, {
      csv: resolve(ROOT, step.csv),
      currency: step.currency ?? scenario.currency ?? 'EUR',
      options: step.options ?? scenario.options ?? {},
      interruptAfter: step.interruptAfter ?? null,
    }));
  }

  const state = readStore(db);
  // A catalogue is read back the way a storefront reads it, so the assertions
  // can be about what a shopper would see rather than about row counts.
  const catalogue = state.products
    .map((product) => ({
      ...product,
      variants: state.variants.filter((variant) => variant.product_id === product.id).sort((a, b) => a.position - b.position),
      categories: state.productCategories
        .filter((link) => link.product_id === product.id)
        .map((link) => state.categories.find((category) => category.id === link.category_id)?.slug)
        .sort(),
      images: state.productImages.filter((image) => image.product_id === product.id).sort((a, b) => a.position - b.position).map((image) => image.image_key),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const extra = {};
  for (const [name, query] of Object.entries(scenario.queries ?? {})) extra[name] = db.prepare(query).all();
  db.close();

  return { runs, state, catalogue, queries: extra };
}

// Run as a script: one scenario on stdin, one result on stdout. Importable as a
// module too, which is what lets the suite reuse migrate()/readStore().
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = readFileSync(0, 'utf8');
  try {
    process.stdout.write(JSON.stringify(runScenario(JSON.parse(input))));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error.message, stack: error.stack }));
    process.exitCode = 1;
  }
}
