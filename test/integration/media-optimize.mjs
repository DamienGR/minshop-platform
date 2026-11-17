import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { applyMigrations } from '../helpers/d1-schema.mjs';
import { GIF_1X1, JPEG_1X1 } from '../helpers/image-bytes.mjs';
import { readImageDimensions } from '../../src/features/media/dimensions.ts';
import { sniffImageMime } from '../../src/features/media/sniff.ts';
import {
  HEAVY_BYTES,
  MEDIA_MOVE_SQL,
  OPTIMIZABLE_SQL,
  OPTIMIZE_BATCH,
  countOptimizableAfter,
  emptyTally,
  isOptimizable,
  listOptimizable,
  optimizableSummary,
  optimizeStoredMedia,
  tally,
} from '../../src/features/media/optimize.ts';

/**
 * « Optimiser » in Médias (ticket #255), against a real D1 with every migration
 * applied and miniflare's offline Images binding, which runs the same call the
 * Worker makes (sharp underneath). A photo already stored gets the upload's
 * transformation, under a new key, and every place that shows it follows in one
 * guarded batch: the gallery and the cover of a product, so a variant keeps its
 * photo; a category; the logo; a page's body and zones, by address. What must
 * not move: the media row's id and public id, `page_media`, the other photos.
 *
 * The rule « this photo is heavy » exists twice, in TypeScript for the grid and
 * in SQL for the counts and the pass; a corpus of rows holds them together.
 */

const MAX_WIDTH = 1000;

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-07-20',
  d1Databases: ['DB'],
  images: { binding: 'IMAGES' },
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

/** A bucket in memory, with the calls it saw. */
function memoryStorage() {
  const objects = new Map();
  const calls = { get: 0, put: 0, delete: 0 };
  return {
    objects,
    calls,
    async put(key, data, contentType) {
      calls.put++;
      objects.set(key, { bytes: new Uint8Array(data.slice(0)), contentType });
    },
    async get(key) {
      calls.get++;
      const object = objects.get(key);
      return object ? { body: new Blob([object.bytes]).stream(), contentType: object.contentType } : null;
    },
    async delete(key) {
      calls.delete++;
      objects.delete(key);
    },
  };
}

const hex = () => [...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, '0')).join('');
const keyFor = (ext = 'jpg') => `media/${hex()}.${ext}`;

try {
  const db = await mf.getD1Database('DB');
  await applyMigrations(db);
  const { IMAGES } = await mf.getBindings();

  /** Bytes through the binding: the way to make a real photo of a given size. */
  const render = async (bytes, transform, output) => {
    const out = await IMAGES.input(new Blob([bytes]).stream()).transform(transform).output(output);
    return new Uint8Array(await out.response().arrayBuffer());
  };
  // A photo as a phone sends it: wider than the store shows any.
  const wideJpeg = await render(JPEG_1X1, { width: 2400, height: 1600, fit: 'cover' }, { format: 'image/jpeg', quality: 100 });
  assert.deepEqual(readImageDimensions(wideJpeg), { width: 2400, height: 1600 });

  /** A stored photo: its object in the bucket and its row in the library. */
  const store = async (storage, bytes, fields = {}) => {
    const type = fields.type ?? sniffImageMime(bytes);
    const key = fields.key ?? keyFor(type === 'image/webp' ? 'webp' : 'jpg');
    if (fields.object !== false) storage.objects.set(key, { bytes, contentType: type });
    const dimensions = readImageDimensions(bytes);
    return db
      .prepare(
        `INSERT INTO media (image_key, original_name, mime_type, size_bytes, width, height, public_id)
         VALUES (?1, 'photo.jpg', ?2, ?3, ?4, ?5, ?6) RETURNING *`,
      )
      .bind(key, type, fields.size ?? bytes.byteLength, fields.width ?? dimensions?.width ?? null, dimensions?.height ?? null, `med_${hex()}`)
      .first();
  };
  const mediaRow = (id) => db.prepare('SELECT * FROM media WHERE id = ?1').bind(id).first();

  /** Every table a test writes, emptied so each starts from a clean library. */
  const reset = async () => {
    await db.batch(
      [
        'DELETE FROM page_media',
        'DELETE FROM pages',
        'DELETE FROM product_variants',
        'DELETE FROM product_images',
        'DELETE FROM product_categories',
        'DELETE FROM products',
        'DELETE FROM categories',
        'DELETE FROM media',
        "DELETE FROM settings WHERE key = 'logo_image_key'",
      ].map((sql) => db.prepare(sql)),
    );
  };

  console.log('Optimiser une photo déjà déposée (ticket #255)');

  await check('every place that shows the photo moves to the lighter file', async () => {
    await reset();
    const storage = memoryStorage();
    const photo = await store(storage, wideJpeg);
    const other = await store(storage, JPEG_1X1);
    const oldKey = photo.image_key;

    const product = await db
      .prepare(`INSERT INTO products (name, price_cents, image_key) VALUES ('Sac', 4500, ?1) RETURNING id`)
      .bind(oldKey)
      .first();
    const cover = await db
      .prepare(`INSERT INTO product_images (product_id, image_key, position, alt) VALUES (?1, ?2, 0, 'Sac rouge') RETURNING id`)
      .bind(product.id, oldKey)
      .first();
    await db
      .prepare(`INSERT INTO product_images (product_id, image_key, position) VALUES (?1, ?2, 1)`)
      .bind(product.id, other.image_key)
      .run();
    const variant = await db
      .prepare(`INSERT INTO product_variants (product_id, label, price_cents, image_id) VALUES (?1, 'Rouge', 4500, ?2) RETURNING id`)
      .bind(product.id, cover.id)
      .first();
    const category = await db
      .prepare(`INSERT INTO categories (name, slug, image_key) VALUES ('Sacs', 'sacs', ?1) RETURNING id`)
      .bind(oldKey)
      .first();
    await db
      .prepare(`INSERT INTO settings (key, value) VALUES ('logo_image_key', ?1)`)
      .bind(oldKey)
      .run();
    const body = [
      `![Le sac](/images/${oldKey})`,
      `![Un autre](/images/${other.image_key})`,
      `Collée d’une boutique qui sert ses images d’un domaine : https://images.example.com/${oldKey}`,
    ].join('\n\n');
    const zones = JSON.stringify({ intro: `![Atelier](/images/${oldKey} "gauche")` });
    const page = await db
      .prepare(`INSERT INTO pages (title, slug, body_markdown, zones) VALUES ('La marque', 'la-marque', ?1, ?2) RETURNING id`)
      .bind(body, zones)
      .first();
    await db.prepare('INSERT INTO page_media (page_id, media_id) VALUES (?1, ?2)').bind(page.id, photo.id).run();

    const result = await optimizeStoredMedia(db, storage, IMAGES, photo, MAX_WIDTH);

    assert.equal(result.status, 'optimized');
    assert.equal(result.oldKey, oldKey);
    assert.match(result.newKey, /^media\/[0-9a-f]{20}\.webp$/);
    assert.equal(result.before, wideJpeg.byteLength);
    assert.ok(result.after < result.before * 0.8, `${result.after} B from ${result.before} B`);
    const newKey = result.newKey;

    // The row is the same media item, with the new file's facts.
    const moved = await mediaRow(photo.id);
    assert.equal(moved.public_id, photo.public_id);
    assert.equal(moved.image_key, newKey);
    assert.equal(moved.mime_type, 'image/webp');
    assert.equal(moved.size_bytes, result.after);
    assert.equal(moved.width, MAX_WIDTH);
    assert.equal(moved.height, 667);
    assert.equal(moved.source_key, oldKey, 'the key the catalogue derives from the original');
    assert.ok(moved.optimized_at);
    assert.equal(isOptimizable(moved, MAX_WIDTH), false);

    // The bucket holds the new file, a real WebP of that size, and not the old.
    assert.equal(storage.objects.has(oldKey), false);
    const stored = storage.objects.get(newKey);
    assert.equal(stored.contentType, 'image/webp');
    assert.equal(sniffImageMime(stored.bytes), 'image/webp');
    assert.equal(stored.bytes.byteLength, result.after);
    assert.deepEqual(readImageDimensions(stored.bytes), { width: MAX_WIDTH, height: 667 });

    // Every place that showed it, the other photo untouched.
    const productRow = await db.prepare('SELECT image_key FROM products WHERE id = ?1').bind(product.id).first();
    assert.equal(productRow.image_key, newKey);
    const gallery = await db
      .prepare('SELECT id, image_key, position, alt FROM product_images WHERE product_id = ?1 ORDER BY position')
      .bind(product.id)
      .all();
    assert.deepEqual(
      gallery.results.map((image) => [image.id, image.image_key, image.position, image.alt]),
      [
        [cover.id, newKey, 0, 'Sac rouge'],
        [gallery.results[1].id, other.image_key, 1, null],
      ],
    );
    const variantRow = await db.prepare('SELECT image_id FROM product_variants WHERE id = ?1').bind(variant.id).first();
    assert.equal(variantRow.image_id, cover.id, 'the variant still shows its photo');
    const categoryRow = await db.prepare('SELECT image_key FROM categories WHERE id = ?1').bind(category.id).first();
    assert.equal(categoryRow.image_key, newKey);
    const logo = await db.prepare(`SELECT value FROM settings WHERE key = 'logo_image_key'`).first();
    assert.equal(logo.value, newKey);
    const pageRow = await db.prepare('SELECT body_markdown, zones FROM pages WHERE id = ?1').bind(page.id).first();
    assert.equal(pageRow.body_markdown, body.replaceAll(oldKey, newKey));
    assert.ok(pageRow.body_markdown.includes(`/images/${other.image_key}`));
    assert.equal(pageRow.zones, zones.replaceAll(oldKey, newKey));
    const links = await db.prepare('SELECT media_id FROM page_media WHERE page_id = ?1').bind(page.id).all();
    assert.deepEqual(links.results.map((link) => link.media_id), [photo.id]);

    // Nothing names the old key any more: a delete would now be judged on the new one.
    const offered = await optimizableSummary(db, MAX_WIDTH);
    assert.deepEqual(offered, { count: 0, bytes: 0 });
  });

  await check('a later move keeps the first key as the source', async () => {
    await reset();
    const storage = memoryStorage();
    const photo = await store(storage, wideJpeg);
    const result = await optimizeStoredMedia(db, storage, IMAGES, photo, MAX_WIDTH);
    assert.equal(result.status, 'optimized');
    const again = keyFor('webp');
    await db.prepare(MEDIA_MOVE_SQL).bind(result.newKey, again, 'image/webp', 100, 800, 533).run();
    const moved = await mediaRow(photo.id);
    assert.equal(moved.image_key, again);
    assert.equal(moved.source_key, photo.image_key);
  });

  await check('a photo with little to gain is marked, and kept as it is', async () => {
    await reset();
    const storage = memoryStorage();
    // Already what an upload makes today, one pixel too wide: re-encoding it
    // gains nothing worth a new key.
    const nearly = await render(wideJpeg, { width: MAX_WIDTH + 1 }, { format: 'image/webp', quality: 82 });
    const photo = await store(storage, nearly);
    assert.equal(photo.width, MAX_WIDTH + 1);
    assert.equal(isOptimizable(photo, MAX_WIDTH), true);

    const result = await optimizeStoredMedia(db, storage, IMAGES, photo, MAX_WIDTH);

    assert.deepEqual(result, { status: 'kept', before: nearly.byteLength });
    const row = await mediaRow(photo.id);
    assert.equal(row.image_key, photo.image_key);
    assert.equal(row.size_bytes, photo.size_bytes);
    assert.equal(row.source_key, null);
    assert.ok(row.optimized_at, 'marked, so never offered again');
    assert.deepEqual([...storage.objects.keys()], [photo.image_key]);
    assert.equal(storage.calls.put, 0);
    assert.deepEqual(await listOptimizable(db, MAX_WIDTH, 0, OPTIMIZE_BATCH), []);
  });

  await check('a photo it does not offer is skipped without reading the bucket', async () => {
    await reset();
    const storage = memoryStorage();
    storage.get = async () => {
      throw new Error('read');
    };
    const rows = [
      // An animation would not survive a WebP still.
      await store(storage, GIF_1X1, { type: 'image/gif', width: 2400, size: HEAVY_BYTES * 2 }),
      // Light and narrow: nothing to do.
      await store(storage, JPEG_1X1, { width: MAX_WIDTH, size: HEAVY_BYTES }),
      // Outside media/, a key a page body could hold inside a longer one.
      await store(storage, wideJpeg, { key: `products/${hex()}.jpg` }),
    ];
    const legacy = await db
      .prepare(`INSERT INTO media (image_key, original_name) VALUES (?1, ?1) RETURNING *`)
      .bind(keyFor())
      .first();
    const done = await store(storage, wideJpeg);
    await db.prepare(`UPDATE media SET optimized_at = datetime('now') WHERE id = ?1`).bind(done.id).run();
    rows.push(legacy, await mediaRow(done.id));

    for (const row of rows) {
      assert.deepEqual(await optimizeStoredMedia(db, storage, IMAGES, row, MAX_WIDTH), { status: 'skipped' }, row.image_key);
    }
    assert.equal(storage.calls.put, 0);
  });

  await check('a photo missing from the bucket fails and changes nothing', async () => {
    await reset();
    const storage = memoryStorage();
    const photo = await store(storage, wideJpeg, { object: false });
    const result = await optimizeStoredMedia(db, storage, IMAGES, photo, MAX_WIDTH);
    assert.deepEqual(result, { status: 'failed', reason: 'missing' });
    assert.deepEqual(await mediaRow(photo.id), photo);
  });

  await check('a transformation that fails changes nothing, and the photo is offered again', async () => {
    const binding = (output) => ({ input: () => ({ transform: () => ({ output }) }) });
    const cases = [
      // Past the Images quota, or an unreadable file.
      [binding(async () => Promise.reject(new Error('quota'))), 'transform'],
      // An empty answer.
      [binding(async () => ({ response: () => new Response(new Uint8Array(0)) })), 'transform'],
      // Something that is not the image it says.
      [binding(async () => ({ response: () => new Response('<!doctype html><p>nope</p>') })), 'invalid'],
    ];
    for (const [images, reason] of cases) {
      await reset();
      const storage = memoryStorage();
      const photo = await store(storage, wideJpeg);
      const result = await optimizeStoredMedia(db, storage, images, photo, MAX_WIDTH);
      assert.deepEqual(result, { status: 'failed', reason });
      assert.deepEqual(await mediaRow(photo.id), photo);
      assert.deepEqual([...storage.objects.keys()], [photo.image_key]);
      assert.equal(storage.calls.put, 0);
      assert.equal((await optimizableSummary(db, MAX_WIDTH)).count, 1);
    }
  });

  await check('a row that changed under it keeps every reference, and the new file goes', async () => {
    await reset();
    const storage = memoryStorage();
    const photo = await store(storage, wideJpeg);
    const product = await db
      .prepare(`INSERT INTO products (name, price_cents, image_key) VALUES ('Sac', 4500, ?1) RETURNING id`)
      .bind(photo.image_key)
      .first();
    await db
      .prepare('INSERT INTO product_images (product_id, image_key, position) VALUES (?1, ?2, 0)')
      .bind(product.id, photo.image_key)
      .run();
    // Between reading the photo and moving it, the row stops holding its key
    // (a second tab's optimization, say, its references still to follow).
    const elsewhere = keyFor('webp');
    const put = storage.put;
    storage.put = async (...args) => {
      await db.prepare('UPDATE media SET image_key = ?2 WHERE image_key = ?1').bind(photo.image_key, elsewhere).run();
      return put(...args);
    };

    const result = await optimizeStoredMedia(db, storage, IMAGES, photo, MAX_WIDTH);

    assert.deepEqual(result, { status: 'failed', reason: 'conflict' });
    const references = await db
      .prepare(
        `SELECT (SELECT image_key FROM products WHERE id = ?1) AS cover,
                (SELECT image_key FROM product_images WHERE product_id = ?1) AS gallery`,
      )
      .bind(product.id)
      .first();
    assert.deepEqual(references, { cover: photo.image_key, gallery: photo.image_key });
    assert.equal((await mediaRow(photo.id)).image_key, elsewhere);
    // Only the original is left: the file this run wrote is gone again.
    assert.deepEqual([...storage.objects.keys()], [photo.image_key]);
  });

  await check('the SQL rule is the TypeScript rule', async () => {
    await reset();
    const rows = [];
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', null]) {
      for (const width of [null, MAX_WIDTH - 1, MAX_WIDTH, MAX_WIDTH + 1]) {
        for (const size of [null, 1000, HEAVY_BYTES, HEAVY_BYTES + 1]) {
          for (const prefix of ['media/', 'Media/', 'products/']) {
            for (const optimized of [null, '2026-11-17 21:00:00']) {
              rows.push({ type, width, size, key: `${prefix}${hex()}.jpg`, optimized });
            }
          }
        }
      }
    }
    await db.batch(
      rows.map((row) =>
        db
          .prepare(
            `INSERT INTO media (image_key, original_name, mime_type, size_bytes, width, optimized_at)
             VALUES (?1, 'x', ?2, ?3, ?4, ?5)`,
          )
          .bind(row.key, row.type, row.size, row.width, row.optimized),
      ),
    );
    const all = (await db.prepare('SELECT * FROM media ORDER BY id').all()).results;
    const expected = all.filter((row) => isOptimizable(row, MAX_WIDTH));
    const viaSql = (
      await db.prepare(`SELECT * FROM media WHERE ${OPTIMIZABLE_SQL} ORDER BY id`).bind(MAX_WIDTH, HEAVY_BYTES).all()
    ).results;
    assert.deepEqual(
      viaSql.map((row) => row.id),
      expected.map((row) => row.id),
    );
    assert.ok(expected.length > 0 && expected.length < all.length);

    assert.deepEqual(await optimizableSummary(db, MAX_WIDTH), {
      count: expected.length,
      bytes: expected.reduce((sum, row) => sum + row.size_bytes, 0),
    });
    // The pass's pages, in id order, cover the same rows once each.
    const paged = [];
    let after = 0;
    for (;;) {
      const page = await listOptimizable(db, MAX_WIDTH, after, OPTIMIZE_BATCH);
      if (page.length === 0) break;
      assert.ok(page.length <= OPTIMIZE_BATCH);
      paged.push(...page.map((row) => row.id));
      after = page.at(-1).id;
      assert.equal(
        await countOptimizableAfter(db, MAX_WIDTH, after),
        expected.filter((row) => row.id > after).length,
      );
    }
    assert.deepEqual(paged, expected.map((row) => row.id));
  });

  await check('a pass reaches every heavy photo once, a failure included', async () => {
    await reset();
    const storage = memoryStorage();
    const photos = [];
    for (let i = 0; i < OPTIMIZE_BATCH + 2; i++) photos.push(await store(storage, wideJpeg, { object: i !== 2 }));

    // The route's loop (src/pages/api/admin/media/optimize.ts), one iteration
    // per request: the cursor moves past every photo it tried.
    let after = 0;
    let requests = 0;
    let total = emptyTally();
    for (;;) {
      const batch = await listOptimizable(db, MAX_WIDTH, after, OPTIMIZE_BATCH);
      if (batch.length === 0) break;
      requests++;
      for (const photo of batch) total = tally(total, await optimizeStoredMedia(db, storage, IMAGES, photo, MAX_WIDTH));
      after = batch.at(-1).id;
      if ((await countOptimizableAfter(db, MAX_WIDTH, after)) === 0) break;
    }

    assert.equal(requests, 2);
    assert.equal(total.optimized, OPTIMIZE_BATCH + 1);
    assert.equal(total.failed, 1);
    assert.equal(total.kept, 0);
    assert.equal(total.bytesBefore, wideJpeg.byteLength * (OPTIMIZE_BATCH + 1));
    assert.ok(total.bytesAfter < total.bytesBefore);
    // The one that failed is still offered, for the next pass.
    const left = await listOptimizable(db, MAX_WIDTH, 0, OPTIMIZE_BATCH);
    assert.deepEqual(left.map((row) => row.id), [photos[2].id]);
  });
} finally {
  await mf.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll media optimization checks passed');
