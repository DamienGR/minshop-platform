/**
 * Audience measurement by Umami (ADR 0034), on the built Worker.
 *
 * Which page draws the tracker is a unit (features/audience/umami.ts). What
 * only the pipeline shows: that the layout reads the setting from the batch
 * middleware loaded, that a token page's `no-referrer` is already on the
 * response when the layout renders (the whole exclusion rests on that order),
 * that the admin pages drawn by the storefront layout stay out, and that the
 * merchant's save in Réglages is what turns it on and off.
 *
 * Run: node --experimental-strip-types test/integration/audience.mjs
 * (after a build — `npm run verify` builds first.)
 */
import assert from 'node:assert/strict';
import { startBuiltWorker } from '../helpers/built-worker.mjs';
import { t } from '../../src/features/i18n/index.ts';
import { hashPassword } from '../../src/features/auth/password.ts';

const ORIGIN = 'https://store.test';
const AUTH_SECRET = 'audience-suite-auth-secret';
const SECRETS_KEK = 'audience-suite-key-encryption-key';
const PASSWORD = 'audience-suite-admin-password';
const FORM = 'application/x-www-form-urlencoded';
const PRODUCT = 'prod_mes0000001';
const SCRIPT = 'https://stats.exemple.fr/script.js';
const ADDRESS = {
  email: 'acheteuse@exemple.fr',
  name: 'Camille Essai',
  line1: '3 quai Ceineray',
  city: 'Nantes',
  postal: '44000',
  country: 'FR',
};
const WEBSITE_ID = '94db1cb1-74f4-4a40-ad6c-962362670409';
/** The one mark of the tracker in a page: its source. */
const TRACKER = `src="${SCRIPT}"`;

const worker = await startBuiltWorker({ vars: { CANONICAL_ORIGIN: ORIGIN, SECRETS_KEK, AUTH_SECRET } });

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

try {
  const { db, fetch } = worker;
  const setting = (key, value) =>
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run();
  await setting('setup_complete', '1');
  await setting('admin_password_hash', await hashPassword(PASSWORD));
  await db
    .prepare(
      `INSERT INTO products (public_id, name, slug, description, price_cents, currency, stock, active)
       VALUES (?, 'Bol en grès', 'bol-en-gres', '', 2400, 'eur', 20, 1)`,
    )
    .bind(PRODUCT)
    .run();

  // The cart is a cookie: keep what the Worker sets, send it back.
  const jar = new Map();
  const keep = (response) => {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const at = pair.indexOf('=');
      jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const post = async (path, fields) =>
    keep(
      await fetch(path, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': FORM, cookie: cookie() },
        body: new URLSearchParams(fields).toString(),
      }),
    );
  const page = async (path, init = {}) => {
    const response = await fetch(path, init);
    assert.equal(response.status, 200, `${path} answered ${response.status}`);
    return response.text();
  };

  const login = await fetch('/admin/login', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': FORM },
    body: new URLSearchParams({ password: PASSWORD }).toString(),
  });
  const session = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const save = (fields) =>
    fetch('/admin/settings', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': FORM, cookie: session },
      body: new URLSearchParams({ _action: 'save_audience', ...fields }).toString(),
    });

  console.log('Éteinte par défaut');

  await check('a shop that has not set it up loads no tracker', async () => {
    for (const path of ['/', `/products/bol-en-gres`, '/cart']) {
      assert.ok(!(await page(path)).includes('data-website-id'), `${path} draws a tracker`);
    }
  });

  console.log('Le réglage');

  await check('the merchant finds the section in Réglages', async () => {
    assert.equal(login.status, 303, 'the admin login failed');
    const html = await page('/admin/settings', { headers: { cookie: session } });
    assert.ok(html.includes(t('admin.settings.section.audience')), 'no section in Réglages');
    assert.ok(html.includes('name="umami_script_url"'), 'no script field');
  });

  await check('half a configuration is refused, and nothing is stored', async () => {
    const refused = await save({ umami_script_url: SCRIPT, umami_website_id: '' });
    assert.equal(refused.status, 200, `expected the form again, got ${refused.status}`);
    assert.ok((await refused.text()).includes(t('admin.settings.audience.error.incomplete')));
    const stored = await db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'umami_%'").first();
    assert.equal(stored.n, 0);
  });

  await check('the pasted tracking code is read for its two values', async () => {
    const saved = await save({
      umami_script_url: `<script defer src="${SCRIPT}" data-website-id="${WEBSITE_ID.toUpperCase()}"></script>`,
      umami_website_id: '',
    });
    assert.equal(saved.status, 303, `the save answered ${saved.status}`);
    const rows = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'umami_%' ORDER BY key").all();
    assert.deepEqual(
      rows.results.map((row) => [row.key, row.value]),
      [
        ['umami_script_url', SCRIPT],
        ['umami_website_id', WEBSITE_ID],
      ],
    );
  });

  console.log('La vitrine');

  await check('storefront pages draw the tracker, with the hook ahead of it', async () => {
    for (const path of ['/', '/products/bol-en-gres', '/cart', '/search?q=bol']) {
      const html = await page(path);
      const at = html.indexOf(TRACKER);
      assert.ok(at > 0, `${path} draws no tracker`);
      const tag = html.slice(html.lastIndexOf('<script', at), html.indexOf('</script>', at));
      for (const attribute of [
        `data-website-id="${WEBSITE_ID}"`,
        'data-domains="store.test"',
        'data-exclude-search="true"',
        'data-exclude-hash="true"',
        'data-do-not-track="true"',
        'data-before-send="minshopUmamiBeforeSend"',
        'defer',
      ]) {
        assert.ok(tag.includes(attribute), `${path}: the tracker lacks ${attribute}`);
      }
      // The hook is a module script: it must come first to run first.
      const head = html.slice(0, at);
      assert.ok(/<script type="module"/.test(head), `${path}: no hook script ahead of the tracker`);
      assert.ok(at < html.indexOf('</head>'), `${path}: the tracker is not in the head`);
    }
  });

  await check('the admin pages the storefront layout draws stay out', async () => {
    assert.ok(!(await page('/admin/login')).includes(TRACKER), '/admin/login draws the tracker');
    assert.ok(!(await page('/admin/token')).includes(TRACKER), '/admin/token draws the tracker');
  });

  await check('a page whose URL opens an order never loads it', async () => {
    // The JSON checkout answers with the payment page's URL: no address step.
    const placed = await fetch('/api/checkout', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ product_id: PRODUCT, quantity: 1 }], method: 'demo', ship_to: ADDRESS }),
    });
    assert.equal(placed.status, 200, `the order was not placed: ${placed.status}`);
    const payPath = new URL((await placed.json()).checkout_url, ORIGIN).pathname;
    assert.match(payPath, /^\/pay\//);
    const pay = await fetch(payPath, { headers: { cookie: cookie() } });
    assert.equal(pay.status, 200, `${payPath} answered ${pay.status}`);
    assert.equal(pay.headers.get('referrer-policy'), 'no-referrer');
    assert.ok(!(await pay.text()).includes(TRACKER), 'the payment page draws the tracker');

    const approved = await post(payPath, { outcome: 'approve' });
    assert.equal(approved.status, 303, `the demo payment did not settle: ${approved.status}`);
    const orderPath = new URL(approved.headers.get('location'), ORIGIN).pathname;
    assert.match(orderPath, /^\/order\//);
    const order = await fetch(orderPath, { headers: { cookie: cookie() } });
    assert.equal(order.status, 200, `${orderPath} answered ${order.status}`);
    assert.equal(order.headers.get('referrer-policy'), 'no-referrer');
    assert.ok(!(await order.text()).includes(TRACKER), 'the order page draws the tracker');
  });

  console.log('L’arrêt');

  await check('two empty fields switch it off everywhere', async () => {
    const saved = await save({ umami_script_url: '', umami_website_id: '' });
    assert.equal(saved.status, 303, `the save answered ${saved.status}`);
    const stored = await db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'umami_%'").first();
    assert.equal(stored.n, 0);
    for (const path of ['/', '/products/bol-en-gres']) {
      assert.ok(!(await page(path)).includes('data-website-id'), `${path} still draws a tracker`);
    }
  });
} finally {
  await worker.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nUmami mesure la vitrine, et seulement elle.');
