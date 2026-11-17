import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { applyMigrations } from '../helpers/d1-schema.mjs';

/**
 * A hidden category (ticket #240, migration 0062), against a real D1 with every
 * migration applied. Hidden means the whole branch: its page is a 404, and it
 * leaves every list the storefront reads — the home's tiles and their line of
 * sub-categories, a category page's sub-categories and products, the menus,
 * the product page, the public API — while its products stay on sale. The rule
 * is ONE subquery (`HIDDEN_CATEGORY_IDS`); the admin derives the same answer
 * from its tree (`flattenTree()`), and this suite holds the two together.
 *
 * Run with the workers loader: the catalog loader imports its siblings without
 * an extension, as the Worker bundle does.
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

  const {
    createCategory,
    updateCategory,
    deleteCategory,
    getCategory,
    listCategories,
    listVisibleCategories,
    getVisibleCategoryBySlug,
    categoriesForProduct,
    categoriesForProducts,
    countProductsInCategory,
    productsInCategory,
    setProductCategories,
    buildTree,
    flattenTree,
    childrenOf,
  } = await import('../../src/features/categories/db.ts');
  const { HIDDEN_CATEGORY_IDS } = await import('../../src/features/categories/visibility.ts');
  const { loadCatalogPage } = await import('../../src/features/storefront/catalog.ts');
  const { readCategoryRows, readProductPageRows } = await import('../../src/features/storefront/reads.ts');
  const { MENU_ITEMS_SQL, addMenuItem, groupMenus } = await import('../../src/features/navigation/db.ts');
  const { targetChoices, unavailableReason } = await import('../../src/features/navigation/admin.ts');

  const slugOf = (name) =>
    name
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
  const fields = (name, parent_id = null, hidden = false) => ({
    name,
    slug: slugOf(name),
    parent_id,
    description: null,
    seo_title: null,
    seo_description: null,
    hidden,
  });
  const create = (name, parent = null) => createCategory(db, fields(name, parent));
  const hide = async (id, hidden = true) => {
    const c = await getCategory(db, id);
    await updateCategory(db, id, { ...fields(c.name, c.parent_id, hidden), slug: c.slug });
  };

  let productSeq = 0;
  const product = async (name, categoryIds) => {
    productSeq++;
    const { id } = await db
      .prepare(
        `INSERT INTO products (public_id, name, slug, description, price_cents, currency, stock, active)
         VALUES (?1, ?2, ?3, '', 1500, 'eur', 5, 1) RETURNING id`,
      )
      .bind(`prod_hiddencat${productSeq}`, name, slugOf(name))
      .first();
    await setProductCategories(db, id, categoryIds);
    return id;
  };

  const names = (rows) => rows.map((c) => c.name);
  const catalog = () =>
    loadCatalogPage(db, {
      base: '/',
      searchParams: new URLSearchParams(),
      responseHeaders: new Headers(),
      imageBaseUrl: '',
      delivery: undefined,
      currency: 'eur',
      eyebrow: 'Boutique',
      heading: 'Tout',
    });
  const menus = async () =>
    groupMenus((await db.prepare(MENU_ITEMS_SQL).all()).results ?? [], null, []);

  // Maison ─┬─ Coussins ── Lin
  //         └─ Noël (hidden later) ── Guirlandes
  // Atelier
  const ids = {};
  ids.Maison = await create('Maison');
  ids.Atelier = await create('Atelier');
  ids.Coussins = await create('Coussins', ids.Maison);
  ids.Lin = await create('Lin', ids.Coussins);
  ids['Noël'] = await create('Noël', ids.Maison);
  ids.Guirlandes = await create('Guirlandes', ids['Noël']);

  const housse = await product('Housse en lin', [ids.Lin]);
  const etoile = await product('Étoile en feutre', [ids.Guirlandes]);
  const sapin = await product('Sapin brodé', [ids['Noël'], ids.Atelier]);

  await addMenuItem(db, { location: 'header', targetType: 'category', targetId: ids.Guirlandes, label: null });
  await addMenuItem(db, { location: 'header', targetType: 'category', targetId: ids.Maison, label: null });

  console.log('\na shop that hides nothing');

  await check('pays for the rule whatever its size, and sees every category', async () => {
    // The partial index: with nothing hidden, the rule's cost does not grow
    // with the categories — the menus ask it on every storefront request.
    const rule = () => db.prepare(`SELECT id FROM categories WHERE id IN ${HIDDEN_CATEGORY_IDS}`).all();
    const before = await rule();
    assert.deepEqual(before.results, []);
    const extra = [];
    for (let i = 0; i < 20; i++) extra.push(await create(`Rayon ${i}`));
    const after = await rule();
    for (const id of extra) await deleteCategory(db, id);
    assert.equal(after.meta.rows_read, before.meta.rows_read);
    assert.ok(after.meta.rows_read < 20, `${after.meta.rows_read} rows read`);
    assert.equal((await listVisibleCategories(db)).length, 6);
    assert.equal(await countProductsInCategory(db, ids.Maison), 3);
  });

  console.log('\nhiding Noël (ticket #240)');
  await hide(ids['Noël']);

  await check('takes its whole branch off the storefront’s list, and nothing else', async () => {
    assert.deepEqual(names(await listVisibleCategories(db)), ['Atelier', 'Coussins', 'Lin', 'Maison']);
  });

  await check('makes its page, and the page of a category under it, a 404', async () => {
    assert.equal(await getVisibleCategoryBySlug(db, 'noel'), null);
    assert.equal(await getVisibleCategoryBySlug(db, 'guirlandes'), null);
    assert.equal((await getVisibleCategoryBySlug(db, 'lin'))?.name, 'Lin');
  });

  await check('leaves the home’s tiles and their line of sub-categories', async () => {
    const model = await catalog();
    assert.deepEqual(
      model.categories.map((c) => [c.text, c.children.map((s) => s.text)]),
      [
        ['Atelier', []],
        ['Maison', ['Coussins']],
      ],
    );
  });

  await check('keeps its products on sale in the catalogue', async () => {
    const model = await catalog();
    assert.deepEqual(model.products.map((p) => p.name).sort(), ['Housse en lin', 'Sapin brodé', 'Étoile en feutre'].sort());
  });

  await check('leaves the page of its parent: sub-categories, products and count', async () => {
    const page = await readCategoryRows(db, ids.Maison, { pageSize: 24, offset: 0, order: 'created_at DESC, id DESC' });
    assert.deepEqual(names(childrenOf(page.categories, ids.Maison)), ['Coussins']);
    assert.deepEqual(names(page.products), ['Housse en lin']);
    assert.equal(page.total, 1);
    assert.deepEqual(names(await productsInCategory(db, ids.Maison, 24)), ['Housse en lin']);
    // A product still in a visible category is listed there.
    assert.deepEqual(names(await productsInCategory(db, ids.Atelier, 24)), ['Sapin brodé']);
  });

  await check('is not named on the product page, nor by the public API', async () => {
    assert.deepEqual(names((await readProductPageRows(db, sapin, 4)).categories), ['Atelier']);
    assert.deepEqual(names((await readProductPageRows(db, etoile, 4)).categories), []);
    assert.deepEqual(names(await categoriesForProduct(db, sapin)), ['Atelier']);
    const byProduct = await categoriesForProducts(db, [housse, etoile, sapin]);
    assert.deepEqual(
      [housse, etoile, sapin].map((id) => names(byProduct.get(id))),
      [['Lin'], [], ['Atelier']],
    );
  });

  await check('is still every box the admin’s product form ticks', async () => {
    // The form writes the whole set back: a box missing would drop the link.
    assert.deepEqual(names(await categoriesForProduct(db, sapin, { includeHidden: true })), ['Atelier', 'Noël']);
  });

  await check('takes a menu link to its branch off the storefront, and says why', async () => {
    const header = (await menus()).header;
    assert.deepEqual(
      header.map((item) => [item.targetName, item.available]),
      [
        ['Guirlandes', false],
        ['Maison', true],
      ],
    );
    assert.equal(unavailableReason(header[0]), 'Catégorie cachée — invisible sur la vitrine');
  });

  await check('cannot be added to a menu, nor offered by its picker', async () => {
    const added = await addMenuItem(db, { location: 'footer', targetType: 'category', targetId: ids['Noël'], label: null });
    assert.equal(added.reason, 'unavailable');
    const underIt = await addMenuItem(db, { location: 'footer', targetType: 'category', targetId: ids.Guirlandes, label: null });
    assert.equal(underIt.reason, 'unavailable');
    const { options, remaining } = await targetChoices(db, 'category', '');
    assert.deepEqual(names(options), ['Atelier', 'Coussins', 'Lin', 'Maison']);
    assert.equal(remaining, 0);
  });

  await check('is told apart in the admin, which agrees with the storefront', async () => {
    const admin = flattenTree(buildTree(await listCategories(db)));
    assert.deepEqual(
      admin.map((r) => [r.name, r.hidden, r.concealed]),
      [
        ['Atelier', false, false],
        ['Maison', false, false],
        ['Coussins', false, false],
        ['Lin', false, false],
        ['Noël', true, true],
        ['Guirlandes', false, true],
      ],
    );
    const visible = new Set((await listVisibleCategories(db)).map((c) => c.id));
    for (const row of admin) assert.equal(row.concealed, !visible.has(row.id), row.name);
  });

  console.log('\nhiding inside a hidden branch, then showing again');

  await check('a box ticked under a hidden parent survives the parent’s return', async () => {
    await hide(ids.Guirlandes);
    await hide(ids['Noël'], false);
    assert.deepEqual(names(await listVisibleCategories(db)), ['Atelier', 'Coussins', 'Lin', 'Maison', 'Noël']);
    assert.equal(await getVisibleCategoryBySlug(db, 'guirlandes'), null);
    assert.equal((await getVisibleCategoryBySlug(db, 'noel'))?.name, 'Noël');
  });

  await check('unticking every box gives the storefront back as it was', async () => {
    await hide(ids.Guirlandes, false);
    assert.equal((await listVisibleCategories(db)).length, 6);
    assert.equal(await countProductsInCategory(db, ids.Maison), 3);
    assert.deepEqual(
      (await menus()).header.map((item) => item.available),
      [true, true],
    );
  });

  await check('a top-level category hides with its whole tree', async () => {
    await hide(ids.Maison);
    assert.deepEqual(names(await listVisibleCategories(db)), ['Atelier']);
    assert.deepEqual(
      (await catalog()).categories.map((c) => c.text),
      ['Atelier'],
    );
    for (const slug of ['maison', 'coussins', 'lin', 'noel', 'guirlandes']) {
      assert.equal(await getVisibleCategoryBySlug(db, slug), null, slug);
    }
  });
} finally {
  await mf.dispose();
}

if (failures > 0) {
  console.error(`\ncategory hidden: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\ncategory hidden: all checks passed');
