import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { applyMigrations } from '../helpers/d1-schema.mjs';

/**
 * A page drawn by a theme's model (ticket #205, ADR 0031), saved into a real
 * D1 with every migration applied.
 *
 * The declaration, the editor's form and the view are units
 * (features/pageModels, features/pages/view.test.ts). What only the database
 * shows is the save: that the zones land beside the body in the one UPDATE,
 * that the photos of every zone a page keeps are claimed in the same batch,
 * so the library refuses to delete one (invariant 10) even when the model
 * that shows it is not in use, and that the maps and markers of the zones
 * the model draws hold back a publication like the body's.
 *
 * Run with the workers loader: the modules import their siblings without an
 * extension, as the Worker bundle does.
 */

const { savePageBody } = await import('../../src/features/pages/save.ts');
const { getPage } = await import('../../src/features/pages/db.ts');
const { deleteMediaRecord } = await import('../../src/features/media/db.ts');
const { readStoredZones } = await import('../../src/features/pageModels/zones.ts');

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

/** The witness model of the atelier theme, as a declaration. */
const POINTS = {
  key: 'points-de-vente',
  label: 'Où nous trouver',
  body: { label: 'Introduction' },
  zones: [
    {
      key: 'points',
      label: 'Points de vente',
      itemLabel: 'Point de vente',
      maxItems: 20,
      fields: [
        { key: 'nom', label: 'Nom', format: 'text', maxLength: 100 },
        { key: 'carte', label: 'Carte', format: 'markdown', maxLength: 1000 },
      ],
    },
  ],
};
const MAP = '```carte\nlieu: Halles\nposition: 47.6582, -2.7608\n```';
const BROKEN_MAP = '```carte\nlieu: Halles\n```';

try {
  const db = await mf.getD1Database('DB');
  await applyMigrations(db);

  const media = async (key) => {
    const row = await db
      .prepare("INSERT INTO media (image_key, original_name) VALUES (?, 'p.png') RETURNING id, image_key")
      .bind(key)
      .first();
    return row;
  };
  const claims = async (pageId) =>
    (await db.prepare('SELECT media_id FROM page_media WHERE page_id = ? ORDER BY media_id').bind(pageId).all())
      .results.map((row) => row.media_id);
  const fields = (page, overrides) => ({
    title: page.title,
    slug: page.slug,
    body_markdown: page.body_markdown,
    published: page.published,
    layout: page.layout,
    ...overrides,
  });

  const { id } = await db
    .prepare("INSERT INTO pages (title, slug, body_markdown) VALUES ('Où nous trouver', 'ou', 'Nos marchés.') RETURNING id")
    .first();
  const zonePhoto = await media('media/halles.png');
  const bodyPhoto = await media('media/atelier.png');

  console.log('\na page row');

  await check('reads « Basique » and no zones until a save says otherwise', async () => {
    const page = await getPage(db, id);
    assert.equal(page.model, '');
    assert.equal(page.zones, '{}');
  });

  console.log('\nsaving a model’s zones');

  await check('stores the model and its zones beside the body, and claims a zone’s photo', async () => {
    const zones = { points: [{ nom: 'Halles', carte: `![Halles](/images/${zonePhoto.image_key})\n\n${MAP}` }] };
    const result = await savePageBody(db, await getPage(db, id), fields(await getPage(db, id), { model: POINTS.key, zones, published: 1 }), {
      pageModel: POINTS,
    });
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(result.mapProblems, []);
    assert.equal(result.published, 1);
    const page = await getPage(db, id);
    assert.equal(page.model, POINTS.key);
    assert.deepEqual(readStoredZones(page.zones), zones);
    assert.deepEqual(await claims(id), [zonePhoto.id]);
    assert.equal(await deleteMediaRecord(db, zonePhoto.id), null, 'a zone’s photo was deletable');
  });

  await check('claims a photo once, in the body and a zone alike, and still publishes', async () => {
    const page = await getPage(db, id);
    const body = `![Atelier](/images/${bodyPhoto.image_key})`;
    const zones = { points: [{ nom: 'Halles', carte: `![A](/images/${bodyPhoto.image_key}) ![H](/images/${zonePhoto.image_key})` }] };
    const result = await savePageBody(db, page, fields(page, { body_markdown: body, zones, published: 0 }), { pageModel: POINTS });
    assert.equal(result.published, 0);
    const again = await savePageBody(db, await getPage(db, id), fields(await getPage(db, id), { published: 1 }), {
      pageModel: POINTS,
    });
    assert.equal(again.published, 1, 'a photo in two places counted twice against the claims');
    assert.deepEqual(await claims(id), [zonePhoto.id, bodyPhoto.id].sort((a, b) => a - b));
  });

  await check('holds a draft back for a map a drawn zone cannot draw, naming the zone', async () => {
    const page = await getPage(db, id);
    await savePageBody(db, page, fields(page, { published: 0 }), { pageModel: POINTS });
    const zones = { points: [{ nom: 'Halles', carte: BROKEN_MAP }] };
    const result = await savePageBody(db, await getPage(db, id), fields(await getPage(db, id), { zones, published: 1 }), {
      pageModel: POINTS,
    });
    assert.equal(result.published, 0);
    assert.equal(result.publishRefused, true);
    assert.equal(result.mapProblems.length, 1);
    // Its lines are the zone’s own, not the body’s.
    assert.match(result.mapProblems[0], /^Points de vente, 1 — Carte — ligne 3\u202f: il manque la position/);
  });

  await check('holds a draft back for markers left in a drawn zone, where production refuses them', async () => {
    const page = await getPage(db, id);
    const zones = { points: [{ nom: 'Halles', carte: 'Ouvert [À COMPLÉTER]' }] };
    const result = await savePageBody(db, page, fields(page, { zones, published: 1 }), {
      pageModel: POINTS,
      refuseIncomplete: true,
    });
    assert.equal(result.incomplete, true);
    assert.equal(result.published, 0);
  });

  console.log('\nleaving the model');

  await check('keeps the zones and their claims, and judges them no more', async () => {
    const page = await getPage(db, id);
    const zones = { points: [{ nom: 'Halles', carte: `![H](/images/${zonePhoto.image_key})\n\n${BROKEN_MAP}` }] };
    // « Basique »: no model, so its zones draw nothing and their map is no reason.
    const result = await savePageBody(db, page, fields(page, { model: '', zones, body_markdown: 'Nos marchés.', published: 1 }), {
      pageModel: null,
    });
    assert.deepEqual(result.mapProblems, []);
    assert.equal(result.published, 1);
    const saved = await getPage(db, id);
    assert.equal(saved.model, '');
    assert.deepEqual(readStoredZones(saved.zones), zones);
    assert.deepEqual(await claims(id), [zonePhoto.id], 'a kept zone’s photo lost its claim');
    assert.equal(await deleteMediaRecord(db, zonePhoto.id), null);
  });

  await check('frees a photo once no zone shows it', async () => {
    const page = await getPage(db, id);
    await savePageBody(db, page, fields(page, { zones: {} }), { pageModel: null });
    assert.deepEqual(await claims(id), []);
    assert.equal((await getPage(db, id)).zones, '{}');
    assert.equal(await deleteMediaRecord(db, zonePhoto.id), zonePhoto.image_key);
  });

  await check('leaves the model and the zones alone when the caller sends neither', async () => {
    const zones = { points: [{ nom: 'Port' }] };
    const page = await getPage(db, id);
    await savePageBody(db, page, fields(page, { model: POINTS.key, zones }), { pageModel: POINTS });
    const kept = await getPage(db, id);
    await savePageBody(db, kept, fields(kept, { title: 'Nos marchés' }), { pageModel: POINTS });
    const saved = await getPage(db, id);
    assert.equal(saved.title, 'Nos marchés');
    assert.equal(saved.model, POINTS.key);
    assert.deepEqual(readStoredZones(saved.zones), zones);
  });
} finally {
  await mf.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} page model check(s) failed`);
  process.exit(1);
}
console.log('\npage models: ok');
