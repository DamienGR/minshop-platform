/**
 * Discount codes and gift cards typed in the shop (ADR 0033), on the built Worker.
 *
 * The rule a code is judged by is a unit (features/discounts/code.ts); what
 * only the pipeline shows is that the merchant's screen makes the codes, that
 * the field appears with the first of them, that the cart applies, refuses
 * and removes one without a code in a URL, that every rail charges the items
 * net of it — the demo from its pending row, the card through a one-off
 * Stripe coupon with Stripe's own field shut — and that the order carries it.
 * That a gift card's single use holds against a second checkout and against
 * two at once, that a basket the code pays in full is refused where nothing
 * can be paid, and that the JSON checkout reads and echoes it.
 *
 * Run: node --experimental-strip-types test/integration/discount-codes.mjs
 * (after a build — `npm run verify` builds first.)
 */
import assert from 'node:assert/strict';
import { startBuiltWorker } from '../helpers/built-worker.mjs';
import { encryptSecret } from '../../src/features/secrets/crypto.ts';
import { t } from '../../src/features/i18n/index.ts';
import { reserveInventory } from '../../src/features/orders/reservations.ts';
import { discountStillHolds } from '../../src/features/discounts/db.ts';
import { hashPassword } from '../../src/features/auth/password.ts';

const ORIGIN = 'https://store.test';
const SECRETS_KEK = 'discount-codes-suite-key-encryption-key';
const AUTH_SECRET = 'discount-codes-suite-auth-secret';
const PASSWORD = 'discount-codes-suite-admin-password';
const FORM = 'application/x-www-form-urlencoded';
const PRODUCT = 'prod_dsc0000001';
const ADDRESS = {
  email: 'acheteuse@exemple.fr',
  name: 'Camille Essai',
  line1: '3 quai Ceineray',
  city: 'Nantes',
  postal: '44000',
  country: 'FR',
};
const GIFT_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Every coupon and Checkout Session the Worker asked Stripe for, as posted. */
const stripeCoupons = [];
const stripeSessions = [];

const worker = await startBuiltWorker({
  vars: { CANONICAL_ORIGIN: ORIGIN, SECRETS_KEK, AUTH_SECRET },
  async outbound(request) {
    const url = new URL(request.url);
    if (url.hostname === 'api.stripe.com' && url.pathname === '/v1/coupons') {
      stripeCoupons.push(new URLSearchParams(await request.text()));
      return Response.json({ id: `coupon_suite${stripeCoupons.length}`, object: 'coupon' });
    }
    if (url.hostname === 'api.stripe.com' && url.pathname === '/v1/checkout/sessions') {
      stripeSessions.push(new URLSearchParams(await request.text()));
      const id = `cs_test_discount${stripeSessions.length}`;
      return Response.json({ id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}` });
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

try {
  const { db, fetch } = worker;
  const setting = (key, value) =>
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value).run();
  await setting('setup_complete', '1');
  await setting('admin_password_hash', await hashPassword(PASSWORD));
  await db
    .prepare(
      `INSERT INTO products (public_id, name, slug, description, price_cents, currency, stock, active)
       VALUES (?, 'Sac à dos', 'sac-a-dos', '', 4500, 'eur', 50, 1)`,
    )
    .bind(PRODUCT)
    .run();
  const productId = (await db.prepare('SELECT id FROM products WHERE public_id = ?').bind(PRODUCT).first()).id;

  // The cart and the applied code are cookies: keep what the Worker sets, send it back.
  const jar = new Map();
  const keep = (response) => {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const at = pair.indexOf('=');
      const [name, value] = [pair.slice(0, at), pair.slice(at + 1)];
      if (value === '' || /max-age=0|expires=thu, 01 jan 1970/i.test(header)) jar.delete(name);
      else jar.set(name, value);
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
  const get = async (path) => keep(await fetch(path, { headers: { cookie: cookie() } }));
  const postJson = (body) =>
    fetch('/api/checkout', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  /** Approve the demo payment a 303 to /pay/… points at; the order page's path. */
  const approve = async (placed) => {
    assert.equal(placed.status, 303, `the order was not placed: ${placed.status}`);
    const pay = await post(new URL(placed.headers.get('location'), ORIGIN).pathname, { outcome: 'approve' });
    assert.equal(pay.status, 303, `the demo payment did not settle: ${pay.status}`);
    return new URL(pay.headers.get('location'), ORIGIN).pathname;
  };
  const codeRow = (code) => db.prepare('SELECT * FROM discount_codes WHERE code = ?').bind(code).first();
  const lastOrder = () =>
    db.prepare('SELECT public_id, discount_cents, discount_code, discount_code_id, amount_total_cents FROM orders ORDER BY id DESC LIMIT 1').first();
  const lastReservation = () =>
    db
      .prepare('SELECT public_id, discount_code, discount_code_id, status FROM checkout_reservations ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .first();
  const lastPending = () =>
    db.prepare('SELECT discount_cents, amount_total_cents, shipping_cents FROM pending_payments ORDER BY rowid DESC LIMIT 1').first();
  const reservationCount = async () => (await db.prepare('SELECT COUNT(*) AS n FROM checkout_reservations').first()).n;

  const login = await fetch('/admin/login', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': FORM },
    body: new URLSearchParams({ password: PASSWORD }).toString(),
  });
  const session = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const adminGet = (path) => fetch(path, { headers: { cookie: session } });
  const adminPost = (path, fields) =>
    fetch(path, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': FORM, cookie: session },
      body: new URLSearchParams(fields).toString(),
    });
  const createCode = (fields) => adminPost('/api/admin/discounts', { kind: 'percent', active: 'on', ...fields });

  assert.equal((await post('/api/cart', { _action: 'add', product_id: PRODUCT })).status, 303);

  console.log('L’écran Codes promo');

  await check('a shop with no code shows no field, and its JSON checkout says it takes codes', async () => {
    assert.equal(login.status, 303, 'the admin login failed');
    assert.ok(!(await (await get('/cart')).text()).includes('name="discount_code"'), 'the cart shows an empty field');
    assert.ok(!(await (await get(`/express?product_id=${PRODUCT}`)).text()).includes('name="discount_code"'));
    assert.equal((await (await fetch('/api/checkout')).json()).discount_codes, true);
    const list = await adminGet('/admin/discounts');
    assert.equal(list.status, 200);
    assert.ok((await list.text()).includes(t('admin.discounts.empty')));
  });

  await check('the merchant creates a code, in capitals, and it brings the field', async () => {
    const created = await createCode({ code: ' noel10 ', value: '10' });
    assert.equal(created.status, 303);
    assert.match(created.headers.get('location'), /^\/admin\/discounts\?saved=1#dsc_/);
    const row = await codeRow('NOEL10');
    assert.ok(row, 'no NOEL10 row');
    assert.deepEqual([row.kind, row.value, row.max_uses, row.active], ['percent', 10, null, 1]);
    const list = await (await adminGet('/admin/discounts')).text();
    assert.ok(list.includes('NOEL10') && list.includes(t('admin.discounts.status.active')), 'the list does not show it');
    assert.match(await (await get('/cart')).text(), /name="discount_code"/);
  });

  await check('a code already taken, or malformed, is refused back to the form', async () => {
    const taken = await createCode({ code: 'Noel10', value: '5' });
    assert.equal(taken.status, 303);
    const to = new URL(taken.headers.get('location'), ORIGIN);
    assert.equal(to.pathname, '/admin/discounts/new');
    assert.equal(to.searchParams.get('error'), t('admin.discounts.error.codeTaken'));
    const bad = await createCode({ code: 'NO', value: '5' });
    assert.equal(new URL(bad.headers.get('location'), ORIGIN).searchParams.get('error'), t('admin.discounts.error.code'));
  });

  let gift = '';
  await check('« Nouvelle carte cadeau » opens on a fixed amount and one use, and draws its code', async () => {
    const form = await (await adminGet('/admin/discounts/new?preset=gift')).text();
    assert.match(form, /<option value="amount" selected/);
    assert.match(form, /name="max_uses"[^>]*value="1"/);
    const created = await createCode({ preset: 'gift', code: '', kind: 'amount', value: '20,00', max_uses: '1' });
    assert.equal(created.status, 303);
    const row = await db.prepare("SELECT * FROM discount_codes WHERE kind = 'amount' ORDER BY id DESC LIMIT 1").first();
    assert.match(row.code, GIFT_PATTERN);
    assert.deepEqual([row.value, row.max_uses], [2000, 1]);
    gift = row.code;
  });

  await check('the edit form keeps the code when its field is emptied, and saves the rest', async () => {
    const row = await codeRow('NOEL10');
    const page = await adminGet(`/admin/discounts/${row.public_id}/edit`);
    assert.equal(page.status, 200);
    const saved = await adminPost(`/api/admin/discounts/${row.public_id}`, {
      code: '',
      kind: 'percent',
      value: '10',
      min_subtotal: '',
      active: 'on',
    });
    assert.equal(saved.status, 303);
    assert.equal((await codeRow('NOEL10'))?.value, 10);
  });

  console.log('Le panier');

  await check('an unknown code is refused, and the URL never repeats it', async () => {
    const refused = await post('/api/discount', { _action: 'apply', discount_code: 'Gaspard' });
    assert.equal(refused.status, 303);
    const location = refused.headers.get('location');
    assert.ok(!location.toLowerCase().includes('gaspard'), 'the code went into the URL');
    assert.equal(new URL(location, ORIGIN).searchParams.get('error'), t('discount.error.unknown'));
    assert.ok(!jar.has('discount'), 'a refused code was remembered');
  });

  await check('« Appliquer » remembers the code and the cart shows what it takes off', async () => {
    const applied = await post('/api/discount', { _action: 'apply', discount_code: 'noel 10' });
    assert.equal(applied.status, 303);
    assert.equal(applied.headers.get('location'), '/cart');
    assert.equal(jar.get('discount'), 'NOEL10');
    const html = await (await get('/cart')).text();
    assert.ok(html.includes('Remise (NOEL10)'), 'the cart shows no discount line');
    assert.ok(html.includes('4,50'), 'the cart does not show 10 % of 45,00 €');
    assert.match(html, /name="discount_code"[^>]*value="NOEL10"|value="NOEL10"[^>]*name="discount_code"/);
  });

  await check('a code under its minimum says the minimum, and the cart says it under the field', async () => {
    await createCode({ code: 'GROSPANIER', value: '15', min_subtotal: '100' });
    const refused = await post('/api/discount', { _action: 'apply', discount_code: 'GROSPANIER' });
    const error = new URL(refused.headers.get('location'), ORIGIN).searchParams.get('error');
    assert.ok(error.startsWith('Ce code s’applique dès 100,00'), error);
    assert.equal(jar.get('discount'), 'NOEL10', 'a refused code replaced the one applied');
  });

  await check('« Retirer le code » forgets it', async () => {
    const removed = await post('/api/discount', { _action: 'remove', discount_code: 'NOEL10' });
    assert.equal(removed.status, 303);
    assert.ok(!jar.has('discount'), 'the code is still remembered');
    assert.ok(!(await (await get('/cart')).text()).includes('Remise (NOEL10)'));
  });

  console.log('La commande');

  await check('the cart’s code reaches the demo order through a 307, net of the discount', async () => {
    const body = { method: 'demo', source: 'cart', discount_code: 'NOEL10' };
    const start = await post('/api/checkout', body);
    assert.equal(start.status, 307, `expected the body to be posted on, got ${start.status}`);
    const next = start.headers.get('location');
    assert.ok(next.startsWith('/checkout?') && next.includes('hop=start'), next);
    assert.ok(!next.includes('NOEL10'), 'the code went into a URL');
    assert.equal(jar.get('discount'), 'NOEL10', 'the code pressed with the button was not remembered');

    const placed = await post(next, body);
    const reservation = await lastReservation();
    assert.equal(reservation.discount_code, 'NOEL10');
    const pending = await lastPending();
    assert.equal(pending.discount_cents, 450);
    assert.equal(pending.amount_total_cents, 4500 - 450 + pending.shipping_cents);

    const orderPage = await approve(placed);
    const order = await lastOrder();
    assert.deepEqual([order.discount_cents, order.discount_code], [450, 'NOEL10']);
    assert.equal(order.discount_code_id, (await codeRow('NOEL10')).id);
    assert.ok((await (await get(orderPage)).text()).includes('Remise (NOEL10)'), 'the order page does not name the code');
    const admin = await (await adminGet(`/admin/orders/${order.public_id}`)).text();
    assert.ok(admin.includes('NOEL10'), 'the admin order page does not name the code');
    const list = await (await adminGet('/admin/discounts')).text();
    assert.ok(list.includes(t('admin.discounts.uses', { count: 1 })), 'the list does not count the use');
  });

  await check('a gift card serves one checkout, and a second is refused before any stock is held', async () => {
    const first = await postJson({
      items: [{ product_id: PRODUCT, quantity: 1 }],
      method: 'demo',
      ship_to: ADDRESS,
      discount_code: gift.toLowerCase(),
    });
    assert.equal(first.status, 200, await first.clone().text());
    const placed = await first.json();
    assert.deepEqual(placed.discount, { code: gift, amount_cents: 2000 });
    assert.equal(placed.total_cents, 4500 - 2000 + (placed.shipping?.amount_cents ?? placed.shipping_cents ?? 0));
    assert.equal((await lastReservation()).discount_code, gift);

    const before = await reservationCount();
    const second = await postJson({
      items: [{ product_id: PRODUCT, quantity: 1 }],
      method: 'demo',
      ship_to: ADDRESS,
      discount_code: gift,
    });
    assert.equal(second.status, 400);
    assert.deepEqual(await second.json(), { error: t('discount.error.unknown'), reason: 'discount_code' });
    assert.equal(await reservationCount(), before);
  });

  await check('two checkouts at once cannot both hold a single-use code', async () => {
    const created = await createCode({ code: 'UNESEULE', kind: 'amount', value: '5', max_uses: '1' });
    assert.equal(created.status, 303);
    const row = await codeRow('UNESEULE');
    const item = { productId, name: 'Sac à dos', priceCents: 4500, quantity: 1 };
    const discount = { id: row.id, code: row.code, amountCents: 500 };
    const hold = (id) => reserveInventory(db, id, [item], 600, 'demo', undefined, undefined, null, null, null, null, null, discount);
    const results = await Promise.all([hold(crypto.randomUUID()), hold(crypto.randomUUID())]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal(await discountStillHolds(db, row.id), false);
  });

  await check('a basket the code pays in full is refused by a bank transfer, and the JSON says why', async () => {
    await setting('bank_transfer_holder', 'Atelier Essai SARL');
    await setting('bank_transfer_iban', 'FR7630006000011234567890189');
    await createCode({ code: 'TOUTOFFERT', value: '100' });
    await db
      .prepare(
        `INSERT INTO products (public_id, name, slug, description, price_cents, currency, stock, active, requires_shipping)
         VALUES ('prod_dsc0000002', 'Carte à imprimer', 'carte-a-imprimer', '', 1500, 'eur', 50, 1, 0)`,
      )
      .run();
    // Nothing to ship, nothing left to pay: no transfer of 0 € can be asked for.
    const before = await reservationCount();
    const refused = await postJson({
      items: [{ product_id: 'prod_dsc0000002', quantity: 1 }],
      method: 'bank_transfer',
      ship_to: ADDRESS,
      discount_code: 'TOUTOFFERT',
    });
    const body = await refused.json();
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.equal(body.reason, 'discount_code');
    assert.equal(body.error, t('discount.error.nothingToPay'));
    assert.equal(await reservationCount(), before);
    // A shipped basket still owes its delivery: the transfer asks for that alone.
    const shipped = await postJson({
      items: [{ product_id: PRODUCT, quantity: 1 }],
      method: 'bank_transfer',
      ship_to: ADDRESS,
      discount_code: 'TOUTOFFERT',
    });
    const placed = await shipped.json();
    assert.equal(shipped.status, 200, JSON.stringify(placed));
    assert.equal(placed.discount.amount_cents, 4500);
    assert.ok(placed.total_cents > 0, 'a transfer of nothing was asked for');
    assert.equal((await lastPending()).amount_total_cents, placed.total_cents);
  });

  console.log('Le paiement par carte');

  await check('Stripe receives the code as a one-off coupon of its amount, its own field shut', async () => {
    await setting('enc:stripe_secret_key', await encryptSecret(SECRETS_KEK, 'sk_test_discount_codes'));
    await setting('enc:stripe_webhook_secret', await encryptSecret(SECRETS_KEK, 'whsec_discount_codes'));
    assert.equal((await post('/api/cart', { _action: 'add', product_id: PRODUCT })).status, 303);
    const started = await post('/api/checkout', { method: 'stripe', source: 'cart', country: 'FR', discount_code: 'NOEL10' });
    assert.ok([303, 307].includes(started.status), `the card checkout did not start: ${started.status}`);
    assert.equal(stripeCoupons.length, 1, 'no coupon was created');
    const coupon = stripeCoupons[0];
    assert.deepEqual(
      [coupon.get('amount_off'), coupon.get('currency'), coupon.get('duration'), coupon.get('max_redemptions'), coupon.get('name')],
      ['450', 'eur', 'once', '1', 'NOEL10'],
    );
    const sessionBody = stripeSessions.at(-1);
    assert.equal(sessionBody.get('discounts[0][coupon]'), 'coupon_suite1');
    assert.equal(sessionBody.get('allow_promotion_codes'), null, 'Stripe’s own field is still open');
    assert.equal((await lastReservation()).discount_code, 'NOEL10');
  });

  await check('a card payment with no code opens no coupon, and no field on Stripe’s page', async () => {
    const before = stripeCoupons.length;
    const started = await post('/api/checkout', { method: 'stripe', source: 'cart', country: 'FR', discount_code: '' });
    assert.ok([303, 307].includes(started.status), `the card checkout did not start: ${started.status}`);
    assert.equal(stripeCoupons.length, before);
    const sessionBody = stripeSessions.at(-1);
    assert.equal(sessionBody.get('discounts[0][coupon]'), null);
    assert.equal(sessionBody.get('allow_promotion_codes'), null);
    assert.ok(!jar.has('discount'), 'an emptied field did not remove the code');
  });

  console.log('Désactiver, supprimer');

  await check('a code switched off is refused, and switched back on accepted', async () => {
    const row = await codeRow('NOEL10');
    assert.equal((await adminPost(`/api/admin/discounts/${row.public_id}`, { _action: 'toggle' })).status, 303);
    const refused = await post('/api/discount', { _action: 'apply', discount_code: 'NOEL10' });
    assert.equal(new URL(refused.headers.get('location'), ORIGIN).searchParams.get('error'), t('discount.error.unknown'));
    await adminPost(`/api/admin/discounts/${row.public_id}`, { _action: 'toggle' });
    assert.equal((await post('/api/discount', { _action: 'apply', discount_code: 'NOEL10' })).headers.get('location'), '/cart');
  });

  await check('a used code is switched off rather than deleted; an unused one goes', async () => {
    const used = await codeRow('NOEL10');
    const kept = await adminPost(`/api/admin/discounts/${used.public_id}`, { _action: 'delete' });
    assert.match(kept.headers.get('location'), /\?kept=1/);
    assert.equal((await codeRow('NOEL10'))?.active, 0);
    const unused = await codeRow('GROSPANIER');
    const gone = await adminPost(`/api/admin/discounts/${unused.public_id}`, { _action: 'delete' });
    assert.equal(gone.headers.get('location'), '/admin/discounts?deleted=1');
    assert.equal(await codeRow('GROSPANIER'), null);
  });

  await check('with the switch off in Réglages, no field and the JSON checkout refuses a code', async () => {
    // The card keys closed the demo rail: the transfer stands in.
    const off = await adminPost('/admin/settings', { _action: 'toggle_feature', feature: 'discounts_enabled', enabled: '0' });
    assert.ok(off.status < 400, `the switch answered ${off.status}`);
    assert.ok(!(await (await get('/cart')).text()).includes('name="discount_code"'));
    assert.ok((await (await adminGet('/admin/discounts')).text()).includes('data-discounts-off'), 'the screen does not warn');
    const refused = await postJson({
      items: [{ product_id: PRODUCT, quantity: 1 }],
      method: 'bank_transfer',
      ship_to: ADDRESS,
      discount_code: 'TOUTOFFERT',
    });
    const said = await refused.json();
    assert.equal(refused.status, 400, JSON.stringify(said));
    assert.equal(said.reason, 'discount_code', JSON.stringify(said));
  });

  await check('no code reached a log line', async () => {
    const logs = worker.logs();
    for (const code of ['NOEL10', 'TOUTOFFERT', gift]) assert.ok(!logs.includes(code), `"${code}" was logged`);
  });
} finally {
  await worker.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nLes codes promo s’appliquent de l’écran au paiement, quel que soit le moyen.');
