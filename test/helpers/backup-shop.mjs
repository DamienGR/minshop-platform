/**
 * A provisioned shop with a shop's worth of rows in it.
 *
 * The backup and restore suites both need the same thing — a real schema, real
 * rows, a real object in a real bucket — and they need it to be the SAME thing,
 * because what one writes the other reads. A second seed would be a second
 * opinion about what a shop looks like.
 *
 * The rows are chosen for what they make the pipeline do, not for realism:
 *
 *  - an apostrophe and a semicolon inside a product description, because every
 *    value a restore writes is INLINED into a SQL file and the statement
 *    splitter has to survive both;
 *  - an order and its line, because `order_items` references `orders` and a
 *    trigger writes `order_item_ids` behind it — the two things an insert in
 *    the wrong order gets wrong;
 *  - a media row with an object behind it in R2, because the inventory is
 *    derived from the rows and the bytes are fetched from the bucket;
 *  - a settings row, because it is the table an operator notices when a restore
 *    silently drops one.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EXIT_CODES } from '../../shopctl/src/errors.mjs';
import { names, shop } from './provisioned-shop.mjs';

/** The image's bytes. Not a real JPEG: what is under test is that the exact
 *  bytes come back, and any byte sequence proves that. */
export const IMAGE_BYTES = Buffer.from('des octets d’image à restaurer', 'utf8');
export const IMAGE_KEY = 'media/abc1230000000000ab.jpg';

/** Text that breaks a naive SQL writer, kept in one place so both suites use it. */
export const HOSTILE = "Lampe d'atelier ; 100 % laiton -- soldée, dite « l'Ampoule »";

export const SEED = [
  `INSERT INTO products (slug, name, description, price_cents, stock, active, sku, public_id)
     VALUES ('lampe', 'Lampe', '${HOSTILE.replaceAll("'", "''")}', 4900, 3, 1, 'LAMP-1', 'prod_0000000001');`,
  `INSERT INTO categories (slug, name, public_id) VALUES ('luminaires', 'Luminaires', 'cat_0000000001');`,
  `INSERT INTO product_categories (product_id, category_id) VALUES (1, 1);`,
  `INSERT INTO media (image_key, original_name, mime_type, size_bytes, public_id)
     VALUES ('${IMAGE_KEY}', 'photo.jpg', 'image/jpeg', ${IMAGE_BYTES.length}, 'med_0000000001');`,
  `UPDATE products SET image_key = '${IMAGE_KEY}' WHERE slug = 'lampe';`,
  `INSERT INTO settings (key, value) VALUES ('store_name', 'Atelier témoin');`,
  `INSERT INTO orders (provider_session_id, email, amount_total_cents, currency, status, public_id)
     VALUES ('cs_test_1', 'client@example.fr', 4900, 'eur', 'paid', 'ord_0000000001');`,
  `INSERT INTO order_items (order_id, product_id, name, price_cents, quantity)
     VALUES (1, 1, 'Lampe', 4900, 1);`,
];

/**
 * A shop whose staging environment exists, is migrated, and holds the seed.
 *
 * `provision` applies the migrations itself, so the schema here is the tree's
 * forty-three files rather than a subset written for the test.
 */
export function seededShop({ env = 'staging', slug = 'atelier-test', seed = SEED, object = true } = {}) {
  const target = shop({ slug, migrations: true });
  const provisioned = target.run(['provision', '--env', env]);
  if (provisioned.status !== EXIT_CODES.ok) throw new Error(`provision failed: ${provisioned.stderr}`);
  if (seed.length > 0) target.sql(seed);

  if (object) {
    const file = join(mkdtempSync(join(tmpdir(), 'shopctl-seed-')), 'image');
    writeFileSync(file, IMAGE_BYTES);
    const put = target.wrangler([
      'r2', 'object', 'put', `${names(slug, env).images}/${IMAGE_KEY}`,
      '--file', file, '--remote', '-J', 'eu',
    ]);
    if (put.status !== 0) throw new Error(`r2 put failed: ${put.stderr}`);
  }

  target.run(['backup', 'keygen']);
  return target;
}

/** Take one backup and return its identifier. */
export function takeBackup(target, args = []) {
  const { report, status, stderr } = target.json(['backup', '--env', 'staging', ...args]);
  if (status !== EXIT_CODES.ok) throw new Error(`backup failed: ${stderr}`);
  return report.id;
}

export { names };
