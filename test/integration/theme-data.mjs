import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { applyMigrations } from '../helpers/d1-schema.mjs';

/**
 * What the core hands a theme, read from a real D1 with every migration
 * applied (tickets #158, #159, #161, #164, #165 — the home of the first real
 * shop). The unit suites pin the builders; this one pins the SQL they are fed:
 * that a listing still returns its page once it carries its variants, that a
 * category's image and sub-categories arrive from the list already read, and
 * what those reads cost in `meta.rows_read`, the counter D1 bills.
 *
 * Run with the workers loader: the loaders import their siblings without an
 * extension, as the Worker bundle does.
 */

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-07-20',
  // SPARE: a second database for the catalogues the main one cannot be at the
  // same time — empty, and entirely sold out.
  d1Databases: ['DB', 'SPARE'],
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

/** The same binding, counting what it reads (test/integration/history-reads.mjs). */
function metered(db) {
  let read = 0;
  const add = (result) => {
    read += result?.meta?.rows_read ?? 0;
    return result;
  };
  const statement = (inner) => ({
    inner,
    bind: (...args) => statement(inner.bind(...args)),
    all: async () => add(await inner.all()),
    run: async () => add(await inner.run()),
    raw: async (options) => inner.raw(options),
    first: async (column) => {
      const { results } = add(await inner.all());
      const row = results?.[0] ?? null;
      return row && column !== undefined ? row[column] : row;
    },
  });
  return {
    binding: {
      prepare: (sql) => statement(db.prepare(sql)),
      batch: async (statements) => (await db.batch(statements.map((s) => s.inner))).map(add),
    },
    take() {
      const n = read;
      read = 0;
      return n;
    },
  };
}

const PRODUCTS = 500;

try {
  const raw = await mf.getD1Database('DB');
  await applyMigrations(raw);
  const { binding: db, take } = metered(raw);

  const { loadCatalogPage } = await import('../../src/features/storefront/catalog.ts');
  const { readCategoryRows, readProductPageRows, readCardVariants } = await import(
    '../../src/features/storefront/reads.ts'
  );
  const { buildProductCard } = await import('../../src/features/storefront/productCard.ts');
  const { getListedProductsByIds } = await import('../../src/features/products/db.ts');

  // 500 products, newest last; the even ones in category 2 (under 1), the odd
  // ones in 3. Product 500 has three fabrics, one sold out, one with its own
  // photo; every product has two variants, so a page has its share to read.
  const n = (sql) =>
    raw.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${PRODUCTS}) ${sql}`).run();
  await n(`INSERT INTO products (name, slug, price_cents, stock, active, public_id, created_at)
             SELECT 'Produit ' || i, 'produit-' || i, 1000 + i, i % 3, 1, printf('prod_t%09d', i),
                    datetime('2026-01-01', '+' || i || ' minutes') FROM n`);
  await raw.batch([
    raw.prepare(`INSERT INTO categories (id, name, slug, public_id, description, image_key)
                 VALUES (1, 'Partir', 'partir', 'cat_tpartir01', 'Pour les voyages.', 'media/partir.jpg'),
                        (2, 'Sacs à dos', 'sacs-a-dos', 'cat_tsacs0001', NULL, NULL),
                        (3, 'Accessoires', 'accessoires', 'cat_taccess01', NULL, NULL),
                        (4, 'Se laver', 'se-laver', 'cat_tlaver001', NULL, NULL)`),
    raw.prepare('UPDATE categories SET parent_id = 1 WHERE id IN (2, 3)'),
    raw.prepare('INSERT INTO media (image_key, original_name, public_id) VALUES (\'media/partir.jpg\', \'partir.jpg\', \'med_tpartir01\')'),
  ]);
  await n(`INSERT INTO product_categories (product_id, category_id) SELECT i, 2 + (i % 2) FROM n`);
  await n(`INSERT INTO product_variants (product_id, label, price_cents, stock, position, active, public_id)
             SELECT i, 'Standard', 1000 + i, 4, 0, 1, printf('var_ta%08d', i) FROM n WHERE i < ${PRODUCTS}`);
  await n(`INSERT INTO product_variants (product_id, label, price_cents, stock, position, active, public_id)
             SELECT i, 'Ancien', 1000 + i, 4, 1, 0, printf('var_tb%08d', i) FROM n WHERE i < ${PRODUCTS}`);
  await raw.batch([
    raw.prepare(`INSERT INTO product_images (id, product_id, image_key, position, alt, public_id)
                 VALUES (900, ${PRODUCTS}, 'media/wax.jpg', 1, 'Sac en wax', 'pimg_twax0001'),
                        (901, 1, 'media/autre.jpg', 0, NULL, 'pimg_tautre01')`),
    raw.prepare(`INSERT INTO product_variants (product_id, label, price_cents, stock, position, active, image_id, public_id)
                 VALUES (${PRODUCTS}, 'Lin', 2600, 0, 1, 1, NULL, 'var_tlin00001'),
                        (${PRODUCTS}, 'Coton', 2400, 3, 0, 1, 901, 'var_tcoton001'),
                        (${PRODUCTS}, 'Wax', 2400, 5, 2, 1, 900, 'var_twax00001')`),
    raw.prepare(`UPDATE products SET variant_label = 'Tissu', stock = 0 WHERE id = ${PRODUCTS}`),
  ]);
  take();

  const catalog = (searchParams = '') =>
    loadCatalogPage(db, {
      base: '/products',
      searchParams: new URLSearchParams(searchParams),
      responseHeaders: new Headers(),
      imageBaseUrl: '',
      delivery: undefined,
      currency: 'eur',
      eyebrow: 'Boutique',
      heading: 'Tout',
    });

  console.log('\ncategories on the catalog model (ticket #158)');

  await check('the top level arrives with its image, its description and its sub-categories', async () => {
    const model = await catalog();
    assert.deepEqual(
      model.categories.map((c) => c.text),
      ['Partir', 'Se laver'],
    );
    const [partir, laver] = model.categories;
    assert.equal(partir.description, 'Pour les voyages.');
    assert.equal(partir.image?.src, '/images/media/partir.jpg');
    assert.deepEqual(partir.children, [
      { text: 'Accessoires', href: '/categories/accessoires' },
      { text: 'Sacs à dos', href: '/categories/sacs-a-dos' },
    ]);
    assert.equal(laver.image, null);
    assert.equal(laver.description, null);
  });

  console.log('\nvariants on the cards (ticket #161)');

  await check('the catalog page carries each card’s active variants, in order', async () => {
    const model = await catalog();
    assert.equal(model.products.length, 24);
    const [newest, next] = model.products;
    assert.equal(newest.name, `Produit ${PRODUCTS}`);
    assert.equal(newest.variantLabel, 'Tissu');
    assert.deepEqual(
      newest.variants.map((v) => [v.label, v.inStock, v.image?.src ?? null]),
      // Coton names ANOTHER product's image: the join refuses to borrow it.
      [
        ['Coton', true, null],
        ['Lin', false, null],
        ['Wax', true, '/images/media/wax.jpg'],
      ],
    );
    assert.equal(newest.variants[2].image?.alt, 'Sac en wax');
    // In stock through its variants although the row says 0; priced from 24 €.
    assert.equal(newest.inStock, true);
    assert.equal(newest.priceVaries, true);
    assert.equal(newest.formattedPrice, '24,00 €');
    // The inactive variant stays out.
    assert.deepEqual(next.variants.map((v) => v.label), ['Standard']);
  });

  await check('every sort keeps its order and its page once wrapped', async () => {
    for (const [query, first] of [
      ['', `Produit ${PRODUCTS}`],
      ['sort=newest&dir=asc', 'Produit 1'],
      ['sort=price&dir=asc', 'Produit 1'],
      ['sort=price&dir=desc', `Produit ${PRODUCTS}`],
      ['sort=name&dir=asc', 'Produit 1'],
    ]) {
      const model = await catalog(query);
      assert.equal(model.products[0].name, first, query);
      assert.equal(model.products.length, 24, query);
    }
    // Page 3 of the default sort is the 49th to 72nd newest.
    const third = await catalog('page=3');
    assert.equal(third.products[0].name, `Produit ${PRODUCTS - 48}`);
  });

  await check('a page past the end is clamped and still carries its variants', async () => {
    const model = await catalog('page=99');
    assert.equal(model.pagination.page, Math.ceil(PRODUCTS / 24));
    assert.ok(model.products.every((card) => card.variants.length === 1));
  });

  await check('the variants cost about their own rows, whatever the sort', async () => {
    // The same page read bare, by the statement the listing wraps. The
    // difference is the variants: an index probe and a row or two per card
    // (each product here has an active and an inactive one), never a second
    // scan of the table — which would be 500 rows more on the newest-first
    // page and 1 000 more on the price-sorted one.
    const { listProductsStatement } = await import('../../src/features/products/db.ts');
    const { catalogPageStatement } = await import('../../src/features/storefront/reads.ts');
    for (const order of ['created_at DESC, id DESC', 'price_cents ASC, id ASC']) {
      take();
      await listProductsStatement(db, 24, 0, order).all();
      const bare = take();
      await catalogPageStatement(db, { pageSize: 24, offset: 0, order }).all();
      const wrapped = take();
      assert.ok(wrapped - bare <= 24 * 5, `${order}: ${bare} rows bare, ${wrapped} with the variants`);
      console.log(`    (${order}: ${bare} rows bare, ${wrapped} with the variants)`);
    }
  });

  await check('a category page carries the variants through its recursive listing', async () => {
    const read = await readCategoryRows(db, 1, { pageSize: 24, offset: 0, order: 'created_at DESC, id DESC' });
    assert.equal(read.total, PRODUCTS);
    assert.equal(read.products.length, 24);
    assert.equal(read.products[0].name, `Produit ${PRODUCTS}`);
    const card = buildProductCard(read.products[0], { currency: 'eur' });
    assert.deepEqual(card.variants.map((v) => v.label), ['Coton', 'Lin', 'Wax']);
  });

  await check('related cards on a product page carry theirs', async () => {
    const rows = await readProductPageRows(db, 2, 8);
    assert.ok(rows.related.length > 0);
    const [first] = rows.related;
    assert.equal(first.name, `Produit ${PRODUCTS}`, 'newest related first');
    assert.equal(buildProductCard(first, { currency: 'eur' }).variants.length, 3);
  });

  await check('stored neighbours and search results get theirs in one read', async () => {
    const neighbours = await getListedProductsByIds(db, [PRODUCTS, 3]);
    assert.deepEqual(neighbours.map((p) => p.id), [PRODUCTS, 3], 'similarity order kept');
    assert.equal(buildProductCard(neighbours[0], { currency: 'eur' }).variants.length, 3);

    take();
    const byId = await readCardVariants(db, [PRODUCTS, 3, 3]);
    const spent = take();
    assert.equal(byId.size, 2);
    const listed = { ...(await raw.prepare(`SELECT * FROM products WHERE id = ${PRODUCTS}`).first()), card_variants: byId.get(PRODUCTS) };
    assert.equal(buildProductCard(listed, { currency: 'eur' }).variants.length, 3);
    assert.ok(spent < 20, `two products' variants read ${spent} rows`);
    assert.equal((await readCardVariants(db, [])).size, 0);
  });

  console.log('\nthe product put forward (ticket #164)');

  const featured = async (featuredProductId) => {
    const model = await loadCatalogPage(db, {
      base: '/',
      searchParams: new URLSearchParams(),
      responseHeaders: new Headers(),
      imageBaseUrl: '',
      delivery: undefined,
      currency: 'eur',
      eyebrow: 'Boutique',
      heading: 'Tout',
      featuredProductId,
    });
    return model.featured;
  };

  await check('the setting holds a row id, and nothing else reads as one', async () => {
    const { parseStoreSettings } = await import('../../src/features/settings/db.ts');
    const id = (value) => parseStoreSettings(value === undefined ? [] : [{ key: 'featured_product', value }]).featuredProductId;
    assert.equal(id('7'), 7);
    for (const value of [undefined, '', '0', '-3', '7.5', 'prod_k7m2qx8vn6']) assert.equal(id(value), null, String(value));
  });

  await check('the merchant’s choice wins, sold out or not, with its variants', async () => {
    await raw.prepare('UPDATE products SET stock = 0 WHERE id = 7').run();
    const card = await featured(7);
    assert.equal(card?.name, 'Produit 7');
    assert.deepEqual(card?.variants.map((v) => v.label), ['Standard']);
    assert.equal(card?.image.priority, true, 'a hero is the likely LCP image');
  });

  await check('without a choice, the newest product that can be sold', async () => {
    assert.equal((await featured(null))?.name, `Produit ${PRODUCTS}`, 'in stock through its variants');
    // Every fabric of the newest sold out: the next newest, whatever its row says.
    await raw.prepare(`UPDATE product_variants SET stock = 0 WHERE product_id = ${PRODUCTS}`).run();
    assert.equal((await featured(null))?.name, `Produit ${PRODUCTS - 1}`);
    await raw.prepare(`UPDATE product_variants SET stock = 3 WHERE product_id = ${PRODUCTS} AND label = 'Coton'`).run();
  });

  await check('an inactive or deleted choice falls back instead of breaking the home', async () => {
    await raw.prepare('UPDATE products SET active = 0 WHERE id = 8').run();
    assert.equal((await featured(8))?.name, `Produit ${PRODUCTS}`);
    assert.equal((await featured(987654))?.name, `Produit ${PRODUCTS}`);
    await raw.prepare('UPDATE products SET active = 1 WHERE id = 8').run();
  });

  await check('a sold-out catalogue still puts its newest forward; an empty one, nothing', async () => {
    const { featuredProductStatement } = await import('../../src/features/storefront/reads.ts');
    const spare = await mf.getD1Database('SPARE');
    await applyMigrations(spare);
    const none = await featuredProductStatement(spare, null).all();
    assert.deepEqual(none.results, [], 'an empty catalogue has nothing to put forward');

    await spare.batch([
      spare.prepare(`INSERT INTO products (id, name, slug, price_cents, stock, active, public_id, created_at)
                     VALUES (1, 'Ancien', 'ancien', 1000, 0, 1, 'prod_tspare01', '2026-01-01'),
                            (2, 'Récent', 'recent', 1000, 0, 1, 'prod_tspare02', '2026-02-01'),
                            (3, 'Caché', 'cache', 1000, 9, 0, 'prod_tspare03', '2026-03-01')`),
      spare.prepare(`INSERT INTO product_variants (product_id, label, price_cents, stock, position, active)
                     VALUES (2, 'Unique', 1000, 0, 0, 1)`),
    ]);
    const soldOut = await featuredProductStatement(spare, null).all();
    assert.equal(soldOut.results[0]?.name, 'Récent', 'everything sold out: the newest active one');
  });

  await check('putting a product forward costs a lookup, not a scan', async () => {
    const { featuredProductStatement } = await import('../../src/features/storefront/reads.ts');
    take();
    await featuredProductStatement(db, 7).all();
    const chosen = take();
    await featuredProductStatement(db, null).all();
    const automatic = take();
    assert.ok(chosen < 10, `the chosen product read ${chosen} rows`);
    assert.ok(automatic < 20, `the automatic choice read ${automatic} rows`);
    console.log(`    (${chosen} rows chosen, ${automatic} automatic)`);
  });

  console.log('\nthe tags a theme reads (ticket #159)');

  await check('a tag set in the admin reaches the cards, the featured hero and the search results', async () => {
    const { storeTags, parseTagsInput } = await import('../../src/features/products/tags.ts');
    const typed = parseTagsInput('Non cousu, Nouveau');
    assert.ok('tags' in typed);
    await raw.prepare(`UPDATE products SET tags = ? WHERE id = ${PRODUCTS}`).bind(storeTags(typed.tags)).run();

    const model = await catalog();
    assert.deepEqual(model.products[0].tags, ['non-cousu', 'nouveau'], 'the newest card');
    assert.deepEqual(model.products[1].tags, [], 'an untagged card');
    assert.deepEqual((await featured(null))?.tags, ['non-cousu', 'nouveau']);

    const [listed] = await getListedProductsByIds(db, [PRODUCTS]);
    assert.deepEqual(buildProductCard(listed, { currency: 'eur' }).tags, ['non-cousu', 'nouveau'], 'search and related');
  });

  console.log('\nthe texts a theme declares (ticket #165)');

  const { parseThemeTextsForm, themeTextField } = await import('../../src/features/themeTexts/slots.ts');
  const { saveThemeTexts, readThemeTexts } = await import('../../src/features/themeTexts/db.ts');
  const slots = [
    { key: 'hero.title', label: 'Titre', default: 'Né à l’atelier', maxLength: 40, format: 'text' },
    { key: 'hero.intro', label: 'Accroche', default: 'Des sacs *cousus main*.', maxLength: 400, format: 'markdown' },
  ];
  const home = async () =>
    (await loadCatalogPage(db, {
      base: '/',
      searchParams: new URLSearchParams(),
      responseHeaders: new Headers(),
      imageBaseUrl: '',
      delivery: undefined,
      currency: 'eur',
      eyebrow: 'Boutique',
      heading: 'Tout',
      textSlots: slots,
    })).texts;
  const save = async (fields) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(themeTextField(key), value);
    const parsed = parseThemeTextsForm(form, slots);
    if ('writes' in parsed) await saveThemeTexts(db, parsed.writes);
    return parsed;
  };

  await check('the home shows the defaults until the merchant writes one', async () => {
    const texts = await home();
    assert.equal(texts['hero.title'].text, 'Né à l’atelier');
    assert.equal(texts['hero.intro'].html, '<p>Des sacs <em>cousus main</em>.</p>\n');
  });

  await check('a saved text replaces its default, an emptied one brings it back', async () => {
    await save({ 'hero.title': 'La carte cadeau', 'hero.intro': 'Le **sur-mesure**.' });
    let texts = await home();
    assert.equal(texts['hero.title'].text, 'La carte cadeau');
    assert.equal(texts['hero.intro'].html, '<p>Le <strong>sur-mesure</strong>.</p>\n');

    await save({ 'hero.title': '', 'hero.intro': 'Des sacs *cousus main*.' });
    texts = await home();
    assert.equal(texts['hero.title'].text, 'Né à l’atelier');
    assert.equal((await readThemeTexts(db)).size, 0, 'neither an empty field nor the default is stored');
  });

  await check('a text too long is refused, and nothing of the form is written', async () => {
    const parsed = await save({ 'hero.intro': 'Nouveau.', 'hero.title': 'x'.repeat(41) });
    assert.ok('error' in parsed);
    assert.match(parsed.error, /41 caractères pour 40 au plus/);
    assert.equal((await readThemeTexts(db)).size, 0);
  });

  await check('the texts ride the catalogue batch, and a theme without slots reads none', async () => {
    await save({ 'hero.title': 'La carte cadeau' });
    take();
    await home();
    const withTexts = take();
    await catalog();
    const without = take();
    assert.ok(withTexts - without <= 2, `the texts read ${withTexts - without} rows`);
    console.log(`    (${without} rows without texts, ${withTexts} with)`);
  });
} finally {
  await mf.dispose();
}

if (failures > 0) {
  console.error(`\ntheme data: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\ntheme data: all checks passed');
