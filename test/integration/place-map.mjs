/**
 * The map of a place in a page (ticket #163, ADR 0029), on the built Worker.
 *
 * The block, the tile arithmetic, the HTML and the relay's headers are units
 * (features/maps, features/pages/markdown.test.ts). What only the pipeline
 * shows is the round a visitor makes: the page draws the map from the shop's
 * own origin and never names the tile server; a tile the page draws is fetched
 * once, with a User-Agent naming the shop and none of the visitor's headers,
 * then served from the edge cache whatever query string rides on it; every
 * other tile — a neighbour, a draft's, a malformed one — is a 404 that never
 * reaches the server; a failure is not cached; a tile costs no settings read,
 * so it is no document; and the admin's preview and save say what is wrong
 * with a block, behind the admin gate.
 *
 * Run: node --experimental-strip-types test/integration/place-map.mjs
 * (after a build — `npm run verify` builds first.)
 */
import assert from 'node:assert/strict';
import { startBuiltWorker } from '../helpers/built-worker.mjs';
import { PNG_1X1 } from '../helpers/image-bytes.mjs';
import { hashPassword } from '../../src/features/auth/password.ts';
import { generatePublicId } from '../../src/features/ids/publicId.ts';

const ORIGIN = 'https://store.test';
const AUTH_SECRET = 'place-map-suite-auth-secret';
const PASSWORD = 'place-map-suite-admin-password';
const FORM = 'application/x-www-form-urlencoded';
const PAGE_ID = generatePublicId('page');
const DRAFT_ID = generatePublicId('page');
const BODY = [
  'Le samedi matin, au marché :',
  '',
  '```carte',
  'lieu: Marché de Vannes',
  'adresse: Place du Poids public',
  'adresse: 56000 Vannes',
  'position: 47.6582, -2.7608',
  '```',
].join('\n');
/** A draft's map, far from the published one, so their tiles never overlap. */
const DRAFT_BODY = '```carte\nlieu: Atelier\nposition: 48.1173, -1.6778\nzoom: 17\n```';

/** Every request the Worker made to the tile server. */
const upstream = [];
/** What the tile server answers next: 'ok' or 'down'. */
let tileServer = 'ok';

const worker = await startBuiltWorker({
  vars: { CANONICAL_ORIGIN: ORIGIN, AUTH_SECRET },
  async outbound(request) {
    const url = new URL(request.url);
    if (url.hostname === 'tile.openstreetmap.org') {
      upstream.push({
        path: url.pathname,
        userAgent: request.headers.get('user-agent'),
        referer: request.headers.get('referer'),
        cookie: request.headers.get('cookie'),
        forwardedFor: request.headers.get('x-forwarded-for'),
      });
      if (tileServer === 'down') return new Response('busy', { status: 503 });
      return new Response(PNG_1X1, {
        headers: { 'content-type': 'image/png', 'cache-control': 'max-age=86400', etag: '"tuile"' },
      });
    }
    return new Response('unexpected outbound call', { status: 502 });
  },
});

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
};

/** The edge-cache write rides on waitUntil, so it can land just after the response. */
async function eventually(predicate, what) {
  for (let i = 0; i < 40; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(what);
}

try {
  const { db, fetch } = worker;
  const setting = (key, value) =>
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run();
  await setting('setup_complete', '1');
  await setting('admin_password_hash', await hashPassword(PASSWORD));
  await db
    .prepare(
      `INSERT INTO pages (title, slug, body_markdown, published, public_id)
       VALUES ('Où me trouver', 'ou-me-trouver', ?, 1, ?),
              ('Atelier', 'atelier', ?, 0, ?),
              ('À propos', 'a-propos', 'L’atelier.', 1, ?)`,
    )
    .bind(BODY, PAGE_ID, DRAFT_BODY, DRAFT_ID, generatePublicId('page'))
    .run();

  const login = await fetch('/admin/login', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': FORM },
    body: new URLSearchParams({ password: PASSWORD }).toString(),
  });
  assert.equal(login.status, 303, 'the admin login failed');
  const session = (login.headers.get('set-cookie') ?? '').split(';')[0];

  console.log('La page');

  const page = await fetch('/pages/ou-me-trouver');
  const html = await page.text();
  const tiles = [...html.matchAll(/<img src="(\/map-tiles\/ou-me-trouver\/(\d+)\/(\d+)\/(\d+))"/g)].map(
    ([, path, z, x, y]) => ({ path, z: Number(z), x: Number(x), y: Number(y) }),
  );

  await check('the page draws the map from the shop’s own origin', async () => {
    assert.equal(page.status, 200);
    assert.ok(html.includes('<figure class="place-map">'), 'no map on the page');
    assert.ok(tiles.length >= 6 && tiles.length <= 12, `${tiles.length} tiles drawn`);
    assert.ok(tiles.every((tile) => tile.z === 16), 'a tile at another zoom');
    assert.ok(!html.includes('tile.openstreetmap.org'), 'the page sends the visitor to the tile server');
    assert.ok(html.includes('href="https://www.openstreetmap.org/copyright"'), 'the credit is missing');
    assert.ok(html.includes('Place du Poids public<br>56000 Vannes'), 'the address is missing');
    assert.equal(upstream.length, 0, 'rendering the page called the tile server');
  });

  await check('the hardening is unchanged: no frame source was opened', async () => {
    const csp = page.headers.get('content-security-policy');
    assert.equal(csp, "object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  });

  console.log('Les tuiles');

  const [first, second, third, fourth] = tiles;

  await check('a tile the page draws is relayed, naming the shop and nothing of the visitor', async () => {
    const response = await fetch(first.path, {
      headers: {
        cookie: `${session}; suivi=visiteur-7f3a`,
        'x-forwarded-for': '203.0.113.42',
        'cf-connecting-ip': '203.0.113.42',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=86400');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG_1X1);
    assert.equal(upstream.length, 1);
    const [call] = upstream;
    assert.equal(call.path, `/${first.z}/${first.x}/${first.y}.png`);
    assert.match(call.userAgent, /^minshop-map-relay\/1 \(\+https:\/\/store\.test\/\)$/);
    assert.equal(call.referer, `${ORIGIN}/`);
    assert.equal(call.cookie, null, 'the visitor’s cookies reached the tile server');
    assert.notEqual(call.forwardedFor, '203.0.113.42', 'the visitor’s address reached the tile server');
  });

  await check('the same tile again comes from the edge cache, query string or not', async () => {
    // The cache write rides on waitUntil, which can land just after the response.
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (const query of ['', '?v=2', '?cache=bust']) {
      const again = await fetch(`${first.path}${query}`);
      assert.equal(again.status, 200, query);
      assert.deepEqual(new Uint8Array(await again.arrayBuffer()), PNG_1X1, query);
    }
    assert.equal(upstream.length, 1, 'the tile was fetched from the server a second time');
  });

  await check('a tile the page does not draw is a 404 that never reaches the server', async () => {
    const xs = tiles.map((tile) => tile.x);
    const ys = tiles.map((tile) => tile.y);
    const outside = [
      `/map-tiles/ou-me-trouver/16/${Math.max(...xs) + 1}/${ys[0]}`,
      `/map-tiles/ou-me-trouver/16/${xs[0]}/${Math.min(...ys) - 1}`,
      `/map-tiles/ou-me-trouver/15/${second.x}/${second.y}`,
      `/map-tiles/ou-me-trouver/16/0/0`,
      // The right tile under a page that draws no map.
      `/map-tiles/a-propos/${second.z}/${second.x}/${second.y}`,
      `/map-tiles/nulle-part/${second.z}/${second.x}/${second.y}`,
    ];
    for (const path of outside) {
      const response = await fetch(path);
      assert.equal(response.status, 404, path);
      assert.equal(response.headers.get('cache-control'), 'no-store', path);
    }
    assert.equal(upstream.length, 1, 'a refused tile reached the server');
  });

  await check('a draft’s map is no reason to fetch a tile', async () => {
    const preview = await fetch('/api/admin/pages/preview', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': FORM, cookie: session },
      body: new URLSearchParams({ body_markdown: DRAFT_BODY }).toString(),
    });
    const draftTile = /src="\/api\/admin\/map-tiles\/(\d+\/\d+\/\d+)"/.exec(await preview.text())?.[1];
    assert.ok(draftTile, 'the preview drew no tile');
    const response = await fetch(`/map-tiles/atelier/${draftTile}`);
    assert.equal(response.status, 404);
    assert.equal(upstream.length, 1);
  });

  await check('a malformed tile is a 404 before anything is read', async () => {
    for (const path of [
      '/map-tiles/ou-me-trouver/99/0/0',
      '/map-tiles/ou-me-trouver/2/0/0',
      '/map-tiles/ou-me-trouver/16/-1/0',
      '/map-tiles/ou-me-trouver/16/1e3/0',
      `/map-tiles/ou-me-trouver/16/${second.x}/${2 ** 16}`,
    ]) {
      assert.equal((await fetch(path)).status, 404, path);
    }
    assert.equal(upstream.length, 1);
  });

  await check('a failure is a 502 that is not cached: the next visitor tries again', async () => {
    worker.clearLogs();
    tileServer = 'down';
    const failed = await fetch(second.path);
    assert.equal(failed.status, 502);
    assert.equal(failed.headers.get('cache-control'), 'no-store');
    assert.equal(upstream.length, 2);
    tileServer = 'ok';
    const retried = await fetch(second.path);
    assert.equal(retried.status, 200);
    assert.equal(upstream.length, 3, 'the failure was served from the cache');
    await eventually(
      () => worker.logs().includes('"event":"map_tile_unavailable","reason":"status","status":503'),
      'the failure left no log line',
    );
  });

  await check('a tile is no document: it skips the first-run funnel and the settings read', async () => {
    await setting('setup_complete', '0');
    try {
      assert.equal((await fetch('/pages/ou-me-trouver')).status, 302, 'the funnel itself is off');
      const response = await fetch(third.path);
      assert.equal(response.status, 200, 'the tile was sent to the setup wizard');
    } finally {
      await setting('setup_complete', '1');
    }
  });

  console.log('L’administration');

  await check('the preview draws through the admin relay, behind the gate', async () => {
    const anonymous = await fetch(fourth.path.replace('/map-tiles/ou-me-trouver/', '/api/admin/map-tiles/'));
    assert.equal(anonymous.status, 401);
    const before = upstream.length;
    const signedIn = await fetch(`/api/admin/map-tiles/17/63250/45000`, { headers: { cookie: session } });
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.headers.get('cache-control'), 'private, no-store');
    assert.equal(upstream.length, before + 1);
  });

  await check('the preview says what is wrong with a block, line by line', async () => {
    const preview = await fetch('/api/admin/pages/preview', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': FORM, cookie: session },
      body: new URLSearchParams({ body_markdown: 'Texte.\n\n```carte\nlieu: Halles\nzoom: 40\n```' }).toString(),
    });
    const text = await preview.text();
    assert.ok(text.includes('class="place-map-error"'), 'no account of the broken block');
    assert.ok(text.includes('ligne 5 : le zoom est un nombre entier de 3 à 19'), text);
    assert.ok(text.includes('ligne 6 : il manque la position du lieu'), text);
  });

  await check('a save with a broken map keeps the text and the draft, and says why', async () => {
    const body = 'Le samedi :\n\n```carte\nlieu: Marché\nposition: Vannes\n```';
    const saved = await fetch(`/api/admin/pages/${DRAFT_ID}`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': FORM, cookie: session },
      body: new URLSearchParams({
        title: 'Atelier',
        slug: 'atelier',
        body_markdown: body,
        published: 'on',
        layout: 'standard',
      }).toString(),
    });
    assert.equal(saved.status, 303);
    const warning = new URL(saved.headers.get('location'), ORIGIN).searchParams.get('warning') ?? '';
    assert.match(warning, /n’a pas été publiée.*une carte est incomplète \(ligne 5/);
    const row = await db.prepare('SELECT published, body_markdown FROM pages WHERE public_id = ?').bind(DRAFT_ID).first();
    assert.equal(row.published, 0, 'a broken map went live');
    assert.equal(row.body_markdown, body, 'the author lost their text');
  });
} finally {
  await worker.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} place-map check(s) failed.`);
  process.exit(1);
}
console.log('\nplace-map: all checks passed.');
