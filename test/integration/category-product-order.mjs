import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { applyMigrations } from '../helpers/d1-schema.mjs';
import { setWorkersEnv } from '../helpers/workers-env.mjs';

/**
 * The order the merchant gives the products of a category (ticket #239,
 * migration 0060), against a real D1 with every migration applied.
 * `productOrder.test.ts` pins how typed ranks move a list, `sort.test.ts` and
 * `test/storefront/catalog.test.ts` which sort a URL means and how its links
 * read; this suite pins the SQL: the admin's form through its route, the
 * storefront's batch under each sort, a newcomer, pagination, and what
 * deleting a product or a category leaves.
 *
 * Run with the workers loader: the route and the storefront read `env.DB`
 * and import their siblings without an extension, as the Worker bundle does.
 */

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-07-20',
  d1Databases: ['DB'],
});

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`  ✗ ${name}\n    ${error.stack ?? error.message}`);
  }
};

try {
  const db = await mf.getD1Database('DB');
  await applyMigrations(db);
  setWorkersEnv({ DB: db });

  const { createCategory, deleteCategory, listProductsForOrdering, getCategory } = await import(
    '../../src/features/categories/db.ts'
  );
  const { deleteProduct } = await import('../../src/features/products/db.ts');
  const { readCategoryRows } = await import('../../src/features/storefront/reads.ts');
  const { categoryOrderClause, parseCategorySortQuery } = await import(
    '../../src/features/products/sort.ts'
  );
  const { POST } = await import('../../src/pages/api/admin/categories/[id].ts');

  const category = (name, parent_id = null) =>
    createCategory(db, {
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      parent_id,
      description: null,
      seo_title: null,
      seo_description: null,
    });

  // Products created a day apart, the first the oldest, so Nouveautés ↓ is
  // the reverse of creation. `price` makes Prix ↑ a third order.
  let day = 0;
  const ids = {};
  const product = async (name, categories, { price = 1000, active = 1 } = {}) => {
    day += 1;
    const created = `2026-01-${String(day).padStart(2, '0')} 10:00:00`;
    const { id } = await db
      .prepare(
        `INSERT INTO products (public_id, name, slug, description, price_cents, currency, stock, active, created_at)
         VALUES (?, ?, ?, '', ?, 'eur', 5, ?, ?) RETURNING id`,
      )
      .bind(`prd_${name.toLowerCase()}${day}`, name, `${name.toLowerCase()}-${day}`, price, active, created)
      .first();
    for (const cid of categories) {
      await db.prepare('INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)').bind(id, cid).run();
    }
    ids[name] = id;
    return id;
  };
  const names = (rows) => rows.map((p) => p.name);

  /** The category page's rows for a query string, as the page reads them. */
  const page = async (categoryId, query = '', { pageSize = 24, offset = 0 } = {}) => {
    const params = new URLSearchParams(query);
    const sort = parseCategorySortQuery(params.get('sort'), params.get('dir'));
    const read = await readCategoryRows(db, categoryId, { pageSize, offset, order: categoryOrderClause(sort) });
    return { ...read, names: names(read.products), sort };
  };

  /** Admin → « Ordre des produits », posted through its route. */
  const post = async (categoryId, fields) => {
    const cat = await getCategory(db, categoryId);
    const form = new FormData();
    for (const [key, value] of fields) form.append(key, value);
    const response = await POST({
      request: new Request(`http://shop.test/api/admin/categories/${cat.public_id}`, { method: 'POST', body: form }),
      params: { id: cat.public_id },
      redirect: (location, status) => new Response(null, { status, headers: { location } }),
    });
    return { status: response.status, location: response.headers.get('location') ?? '' };
  };
  /** The admin's list as shown, with `typed` ranks over it: name → rank. */
  const saveRanks = async (categoryId, typed = {}) => {
    const { products } = await listProductsForOrdering(db, categoryId);
    const fields = [['_action', 'productOrder']];
    products.forEach((p, i) => {
      fields.push(['product', p.public_id]);
      fields.push([`rank-${p.public_id}`, String(typed[p.name] ?? i + 1)]);
    });
    return post(categoryId, fields);
  };

  const univers = await category('Univers');
  const sacs = await category('Sacs', univers);
  const bijoux = await category('Bijoux', univers);
  await product('Cabas', [univers], { price: 4000 });
  await product('Pochette', [sacs], { price: 1500 });
  await product('Bague', [bijoux], { price: 2500 });
  await product('Collier', [bijoux, univers], { price: 3500 });
  await product('Brouillon', [sacs], { price: 500, active: 0 });
  await product('Besace', [sacs], { price: 3000 });

  console.log('\na category with no order (ticket #239)');

  await check('reads exactly as Nouveautés ↓, and says it has no order', async () => {
    const bare = await page(univers);
    assert.equal(bare.ordered, false);
    assert.equal(bare.sort.sort, 'manual');
    assert.deepEqual(bare.names, ['Besace', 'Collier', 'Bague', 'Pochette', 'Cabas']);
    assert.deepEqual((await page(univers, 'sort=newest&dir=desc')).names, bare.names);
  });

  await check('the admin lists every product the page can show, offline ones too, newest first', async () => {
    const { ordered, products } = await listProductsForOrdering(db, univers);
    assert.equal(ordered, false);
    assert.deepEqual(names(products), ['Besace', 'Brouillon', 'Collier', 'Bague', 'Pochette', 'Cabas']);
    assert.ok(products.every((p) => p.manual_position === null));
  });

  console.log('\nsaving an order from the admin');

  await check('a rank typed moves that product, the others keep their order', async () => {
    // Cabas, 6th, typed 1; Bague, 4th, typed 2.
    const { status, location } = await saveRanks(univers, { Cabas: 1, Bague: 2 });
    assert.equal(status, 303);
    assert.match(location, /\/products\?saved=1$/);
    const { ordered, products } = await listProductsForOrdering(db, univers);
    assert.equal(ordered, true);
    assert.deepEqual(names(products), ['Cabas', 'Bague', 'Besace', 'Brouillon', 'Collier', 'Pochette']);
    assert.deepEqual(products.map((p) => p.manual_position), [1, 2, 3, 4, 5, 6]);
  });

  await check('the bare path follows it, the offline product left out, « Par défaut » on offer', async () => {
    const bare = await page(univers);
    assert.equal(bare.ordered, true);
    assert.deepEqual(bare.names, ['Cabas', 'Bague', 'Besace', 'Collier', 'Pochette']);
  });

  await check('Nouveautés, Prix and Nom are unchanged by it', async () => {
    assert.deepEqual((await page(univers, 'sort=newest&dir=desc')).names, ['Besace', 'Collier', 'Bague', 'Pochette', 'Cabas']);
    assert.deepEqual((await page(univers, 'sort=price&dir=asc')).names, ['Pochette', 'Bague', 'Besace', 'Collier', 'Cabas']);
    assert.deepEqual((await page(univers, 'sort=name&dir=asc')).names, ['Bague', 'Besace', 'Cabas', 'Collier', 'Pochette']);
    // ?dir=asc alone has always meant Nouveautés ↑: the pagination wrote it.
    assert.deepEqual((await page(univers, 'dir=asc')).names, ['Cabas', 'Pochette', 'Bague', 'Collier', 'Besace']);
  });

  await check('a page of the order follows on from the one before', async () => {
    const first = await page(univers, '', { pageSize: 2, offset: 0 });
    const second = await page(univers, '', { pageSize: 2, offset: 2 });
    const third = await page(univers, '', { pageSize: 2, offset: 4 });
    assert.equal(first.total, 5);
    assert.deepEqual([...first.names, ...second.names, ...third.names], ['Cabas', 'Bague', 'Besace', 'Collier', 'Pochette']);
  });

  await check('a sub-category keeps its own sort: its page has no order', async () => {
    const sub = await page(bijoux);
    assert.equal(sub.ordered, false);
    assert.deepEqual(sub.names, ['Collier', 'Bague']);
  });

  await check('the form cannot name a product the page does not show', async () => {
    const stranger = await product('Ailleurs', []);
    const { public_id: foreign } = await db.prepare('SELECT public_id FROM products WHERE id = ?').bind(stranger).first();
    const { products } = await listProductsForOrdering(db, univers);
    const fields = [['_action', 'productOrder'], ['product', foreign], [`rank-${foreign}`, '1']];
    for (const p of products) fields.push(['product', p.public_id]);
    await post(univers, fields);
    const after = await listProductsForOrdering(db, univers);
    assert.deepEqual(names(after.products), names(products));
    const { n } = await db
      .prepare('SELECT COUNT(*) AS n FROM category_product_positions WHERE product_id = ?')
      .bind(stranger)
      .first();
    assert.equal(n, 0);
  });

  await check('a form with nothing to rank writes nothing and says so', async () => {
    const { location } = await post(univers, [['_action', 'productOrder']]);
    assert.match(location, /\/products\?error=/);
    assert.equal((await listProductsForOrdering(db, univers)).products[0].name, 'Cabas');
  });

  console.log('\nproducts arriving after the order');

  await check('follow the placed ones, newest first, until placed', async () => {
    await product('Sautoir', [bijoux]);
    await product('Tote', [sacs]);
    assert.deepEqual((await page(univers)).names, ['Cabas', 'Bague', 'Besace', 'Collier', 'Pochette', 'Tote', 'Sautoir']);
    const { products } = await listProductsForOrdering(db, univers);
    assert.deepEqual(
      products.filter((p) => p.manual_position === null).map((p) => p.name),
      ['Tote', 'Sautoir'],
    );
    // Placed at the next save, in the order shown, or where typed.
    await saveRanks(univers, { Sautoir: 1 });
    assert.deepEqual((await page(univers)).names, ['Sautoir', 'Cabas', 'Bague', 'Besace', 'Collier', 'Pochette', 'Tote']);
  });

  await check('a product leaving the category leaves the page; the next save drops its row', async () => {
    await db.prepare('DELETE FROM product_categories WHERE product_id = ?').bind(ids.Besace).run();
    assert.deepEqual((await page(univers)).names, ['Sautoir', 'Cabas', 'Bague', 'Collier', 'Pochette', 'Tote']);
    await saveRanks(univers);
    const { n } = await db
      .prepare('SELECT COUNT(*) AS n FROM category_product_positions WHERE category_id = ? AND product_id = ?')
      .bind(univers, ids.Besace)
      .first();
    assert.equal(n, 0);
  });

  console.log('\nremoving');

  await check('deleting a product deletes its place in every order', async () => {
    await saveRanks(bijoux);
    await deleteProduct(db, ids.Collier);
    const { n } = await db
      .prepare('SELECT COUNT(*) AS n FROM category_product_positions WHERE product_id = ?')
      .bind(ids.Collier)
      .first();
    assert.equal(n, 0);
    assert.deepEqual((await page(univers)).names, ['Sautoir', 'Cabas', 'Bague', 'Pochette', 'Tote']);
  });

  await check('« Supprimer l’ordre » brings the page back to Nouveautés', async () => {
    const { location } = await post(univers, [['_action', 'clearProductOrder']]);
    assert.match(location, /\/products\?cleared=1$/);
    const bare = await page(univers);
    assert.equal(bare.ordered, false);
    assert.deepEqual(bare.names, (await page(univers, 'sort=newest&dir=desc')).names);
    // The sub-category's own order is not its parent's.
    assert.equal((await page(bijoux)).ordered, true);
  });

  await check('deleting a category deletes its order, and only its own', async () => {
    await saveRanks(univers);
    await deleteCategory(db, bijoux);
    const left = await db
      .prepare('SELECT category_id, COUNT(*) AS n FROM category_product_positions GROUP BY category_id')
      .all();
    // Univers keeps its six rows, Sautoir's and Bague's included: they left its
    // page with Bijoux, read nothing, and go at its next save.
    assert.deepEqual(left.results, [{ category_id: univers, n: 6 }]);
    assert.deepEqual((await page(univers)).names, ['Tote', 'Pochette', 'Cabas']);
  });

  console.log('\na long list');

  await check('saves and reads back past one statement’s worth of rows', async () => {
    const grand = await category('Grand');
    for (let i = 0; i < 130; i++) await product(`P${i}`, [grand]);
    const { products } = await listProductsForOrdering(db, grand);
    // The oldest product, last on the list, typed 1.
    await saveRanks(grand, { P0: 1 });
    const read = await listProductsForOrdering(db, grand);
    assert.equal(read.products.length, 130);
    assert.deepEqual(read.products.map((p) => p.manual_position), Array.from({ length: 130 }, (_, i) => i + 1));
    assert.equal(read.products[0].name, 'P0');
    assert.deepEqual(names(read.products.slice(1)), names(products.slice(0, 129)));
    const { names: firstPage } = await page(grand);
    assert.deepEqual(firstPage, names(read.products.slice(0, 24)));
  });
} finally {
  await mf.dispose();
}

if (failures > 0) {
  console.error(`\ncategory product order: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\ncategory product order: all checks passed');
