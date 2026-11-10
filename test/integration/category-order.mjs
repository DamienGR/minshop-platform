import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { applyMigrations } from '../helpers/d1-schema.mjs';

/**
 * The order of the categories (ticket #228, migration 0059), against a real D1
 * with every migration applied. `order.test.ts` pins the rule; this suite pins
 * the SQL that writes it — the subquery that places a newcomer, the CASE
 * statements of a move, the batch of a deletion — and that the lists the
 * storefront and the admin read come back in the order written.
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
    moveCategory,
    listCategories,
    getCategory,
    childrenOf,
    buildTree,
    flattenTree,
  } = await import('../../src/features/categories/db.ts');
  const { loadCatalogPage } = await import('../../src/features/storefront/catalog.ts');
  const { readCategoryRows } = await import('../../src/features/storefront/reads.ts');

  const fields = (name, parent_id = null) => ({
    name,
    slug: name
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-'),
    parent_id,
    description: null,
    seo_title: null,
    seo_description: null,
  });
  const create = (name, parent = null) => createCategory(db, fields(name, parent));
  const family = async (parent = null) => childrenOf(await listCategories(db), parent).map((c) => c.name);
  const positions = async (parent = null) =>
    Object.fromEntries(childrenOf(await listCategories(db), parent).map((c) => [c.name, c.position]));

  console.log('\na shop that ranges nothing (ticket #228)');

  const ids = {};
  for (const name of ['Zéro déchet', 'Carte cadeau', 'Univers féminin', 'Créations bébés']) {
    ids[name] = await create(name);
  }
  for (const name of ['Sacs et pochettes', 'Bien-être', 'Se faire belle', 'Accessoires']) {
    ids[name] = await create(name, ids['Univers féminin']);
  }

  await check('stays alphabetical, every position 0, newcomers included', async () => {
    assert.deepEqual(await family(), ['Carte cadeau', 'Créations bébés', 'Univers féminin', 'Zéro déchet']);
    assert.deepEqual(Object.values(await positions()), [0, 0, 0, 0]);
    assert.deepEqual(await family(ids['Univers féminin']), [
      'Accessoires',
      'Bien-être',
      'Sacs et pochettes',
      'Se faire belle',
    ]);
    assert.deepEqual(Object.values(await positions(ids['Univers féminin'])), [0, 0, 0, 0]);
  });

  console.log('\nmoving a category among its siblings');

  await check('the first move in a family never ranged moves it one rank', async () => {
    assert.equal(await moveCategory(db, ids['Zéro déchet'], 'up'), true);
    assert.deepEqual(await family(), ['Carte cadeau', 'Créations bébés', 'Zéro déchet', 'Univers féminin']);
    // The whole family is written, 1 to n: a ranged family is recognisable.
    assert.deepEqual(await positions(), {
      'Carte cadeau': 1,
      'Créations bébés': 2,
      'Zéro déchet': 3,
      'Univers féminin': 4,
    });
    // The other families are untouched.
    assert.deepEqual(Object.values(await positions(ids['Univers féminin'])), [0, 0, 0, 0]);
  });

  await check('reaches the order of the shop’s current site, at both levels', async () => {
    await moveCategory(db, ids['Zéro déchet'], 'up');
    await moveCategory(db, ids['Zéro déchet'], 'up');
    await moveCategory(db, ids['Carte cadeau'], 'down');
    await moveCategory(db, ids['Carte cadeau'], 'down');
    assert.deepEqual(await family(), ['Zéro déchet', 'Créations bébés', 'Univers féminin', 'Carte cadeau']);

    const under = ids['Univers féminin'];
    await moveCategory(db, ids['Sacs et pochettes'], 'up');
    await moveCategory(db, ids['Sacs et pochettes'], 'up');
    await moveCategory(db, ids['Accessoires'], 'down');
    await moveCategory(db, ids['Accessoires'], 'down');
    assert.deepEqual(await family(under), ['Sacs et pochettes', 'Bien-être', 'Se faire belle', 'Accessoires']);
  });

  await check('first up and last down move nothing, and say so', async () => {
    assert.equal(await moveCategory(db, ids['Zéro déchet'], 'up'), false);
    assert.equal(await moveCategory(db, ids['Carte cadeau'], 'down'), false);
    assert.equal(await moveCategory(db, 9999, 'up'), false);
    assert.deepEqual(await family(), ['Zéro déchet', 'Créations bébés', 'Univers féminin', 'Carte cadeau']);
  });

  await check('the home, a category page and the admin read that order', async () => {
    const model = await loadCatalogPage(db, {
      base: '/',
      searchParams: new URLSearchParams(),
      responseHeaders: new Headers(),
      imageBaseUrl: '',
      delivery: undefined,
      currency: 'eur',
      eyebrow: 'Boutique',
      heading: 'Tout',
    });
    assert.deepEqual(
      model.categories.map((c) => c.text),
      ['Zéro déchet', 'Créations bébés', 'Univers féminin', 'Carte cadeau'],
    );
    assert.deepEqual(
      model.categories[2].children.map((c) => c.text),
      ['Sacs et pochettes', 'Bien-être', 'Se faire belle', 'Accessoires'],
    );

    const page = await readCategoryRows(db, ids['Univers féminin'], {
      pageSize: 24,
      offset: 0,
      order: 'created_at DESC, id DESC',
    });
    assert.deepEqual(
      childrenOf(page.categories, ids['Univers féminin']).map((c) => c.name),
      ['Sacs et pochettes', 'Bien-être', 'Se faire belle', 'Accessoires'],
    );

    const admin = flattenTree(buildTree(await listCategories(db)));
    assert.deepEqual(
      admin.map((r) => r.name),
      [
        'Zéro déchet',
        'Créations bébés',
        'Univers féminin',
        'Sacs et pochettes',
        'Bien-être',
        'Se faire belle',
        'Accessoires',
        'Carte cadeau',
      ],
    );
  });

  await check('a family past one write chunk (30 rows) is written whole', async () => {
    const parent = await create('Grande famille');
    const members = [];
    for (let i = 1; i <= 35; i++) members.push(await create(`Membre ${String(i).padStart(2, '0')}`, parent));
    assert.equal(await moveCategory(db, members.at(-1), 'up'), true);
    const order = await family(parent);
    assert.equal(order.length, 35);
    assert.deepEqual(order.slice(-2), ['Membre 35', 'Membre 34']);
    assert.deepEqual(Object.values(await positions(parent)), Array.from({ length: 35 }, (_, i) => i + 1));
    await deleteCategory(db, parent);
    for (const id of members) await deleteCategory(db, id);
    assert.deepEqual(await family(), ['Zéro déchet', 'Créations bébés', 'Univers féminin', 'Carte cadeau']);
  });

  console.log('\na category joining a family');

  await check('created in a ranged family, it goes last', async () => {
    ids['Maison'] = await create('Maison');
    assert.equal((await family()).at(-1), 'Maison');
    assert.equal((await getCategory(db, ids['Maison'])).position, 5);
  });

  await check('created in a family never ranged, it takes its alphabetical place', async () => {
    const under = ids['Créations bébés'];
    ids['Doudous'] = await create('Doudous', under);
    ids['Bavoirs'] = await create('Bavoirs', under);
    ids['Capes de bain'] = await create('Capes de bain', under);
    assert.deepEqual(await family(under), ['Bavoirs', 'Capes de bain', 'Doudous']);
    assert.deepEqual(Object.values(await positions(under)), [0, 0, 0]);
  });

  await check('moved under another parent, it goes last if that family is ranged', async () => {
    await updateCategory(db, ids['Doudous'], fields('Doudous', ids['Univers féminin']));
    assert.equal((await family(ids['Univers féminin'])).at(-1), 'Doudous');
    assert.equal((await getCategory(db, ids['Doudous'])).position, 5);
    // Saving it again where it is keeps its place.
    await updateCategory(db, ids['Doudous'], { ...fields('Doudous', ids['Univers féminin']), description: 'Tout doux.' });
    assert.equal((await getCategory(db, ids['Doudous'])).position, 5);
    // And back into a family never ranged: its alphabetical place, 0.
    await updateCategory(db, ids['Doudous'], fields('Doudous', ids['Créations bébés']));
    assert.equal((await getCategory(db, ids['Doudous'])).position, 0);
    assert.deepEqual(await family(ids['Créations bébés']), ['Bavoirs', 'Capes de bain', 'Doudous']);
  });

  await check('raised a level when its parent is deleted, in their order, last of a ranged family', async () => {
    await deleteCategory(db, ids['Univers féminin']);
    assert.deepEqual(await family(), [
      'Zéro déchet',
      'Créations bébés',
      'Carte cadeau',
      'Maison',
      'Sacs et pochettes',
      'Bien-être',
      'Se faire belle',
      'Accessoires',
    ]);
    assert.deepEqual(Object.values(await positions()).slice(-4), [6, 7, 8, 9]);
  });

  await check('raised into a family never ranged, they take their alphabetical place', async () => {
    // Under Maison (top level, ranged): Coussins, whose children are ranged…
    const maison = ids['Maison'];
    const coussins = await create('Coussins', maison);
    const nappes = await create('Nappes', maison);
    const lin = await create('Lin', coussins);
    const coton = await create('Coton', coussins);
    await moveCategory(db, lin, 'up');
    assert.deepEqual(await family(coussins), ['Lin', 'Coton']);
    // …into Maison's family, never ranged: alphabetical, with Nappes.
    await deleteCategory(db, coussins);
    assert.deepEqual(await family(maison), ['Coton', 'Lin', 'Nappes']);
    assert.deepEqual(Object.values(await positions(maison)), [0, 0, 0]);
    assert.ok(nappes);
  });

  await check('raised into a level with nobody else, they keep their order', async () => {
    const seul = await create('Seul', ids['Bavoirs']);
    const b = await create('B', seul);
    const a = await create('A', seul);
    await moveCategory(db, b, 'up');
    assert.deepEqual(await family(seul), ['B', 'A']);
    await deleteCategory(db, seul);
    assert.deepEqual(await family(ids['Bavoirs']), ['B', 'A']);
    assert.ok(a);
  });
} finally {
  await mf.dispose();
}

if (failures > 0) {
  console.error(`\ncategory order: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\ncategory order: all checks passed');
