/**
 * The buyer's comment on an order (ticket #162, ADR 0028), on the built Worker.
 *
 * The rule a comment is judged by is a unit (features/orders/comment.ts); what
 * only the pipeline shows is that the merchant's switch decides whether it is
 * asked at all, and that every way into a sale carries it to the order and
 * nowhere else: the cart through the demo rail (a 307, never a URL), every
 * step of /checkout, the JSON checkout, the Lightning page that settles from
 * its pending row, and a card payment, whose Stripe session never sees it.
 * That a reservation lets it go, that the order page and the admin read it
 * back escaped, and that no log line holds it.
 *
 * Run: node --experimental-strip-types test/integration/order-comment.mjs
 * (after a build — `npm run verify` builds first.)
 */
import assert from 'node:assert/strict';
import { startBuiltWorker } from '../helpers/built-worker.mjs';
import { encryptSecret } from '../../src/features/secrets/crypto.ts';
import { t } from '../../src/features/i18n/index.ts';
import { ORDER_COMMENT_MAX_LENGTH } from '../../src/features/orders/comment.ts';
import { releaseInventoryReservation, reserveInventory } from '../../src/features/orders/reservations.ts';
import { recordPaidOrder } from '../../src/features/orders/db.ts';
import { pendingToPaidOrder } from '../../src/features/payments/lightning/pending.ts';
import { hashPassword } from '../../src/features/auth/password.ts';

const ORIGIN = 'https://store.test';
const SECRETS_KEK = 'order-comment-suite-key-encryption-key';
const AUTH_SECRET = 'order-comment-suite-auth-secret';
const PASSWORD = 'order-comment-suite-admin-password';
const FORM = 'application/x-www-form-urlencoded';
const PRODUCT = 'prod_cmt0000001';
const ADDRESS = {
  email: 'acheteuse@exemple.fr',
  name: 'Camille Essai',
  line1: '3 quai Ceineray',
  city: 'Nantes',
  postal: '44000',
  country: 'FR',
};
/** As a browser posts a textarea: CRLF, a run of blank lines, markup typed as text. */
const TYPED = 'Prénom à broder : Léa\r\n\r\n\r\nMerci   beaucoup <b>Zoé</b>';
const KEPT = 'Prénom à broder : Léa\n\nMerci beaucoup <b>Zoé</b>';
/** What an escaped page shows of it. */
const ESCAPED = 'Merci beaucoup &lt;b&gt;Zoé&lt;/b&gt;';
/** The words a buyer typed in this suite: none may reach a URL or a log line. */
const WORDS = ['Léa', 'Zoé', 'Inès', 'Tom', 'Gaspard', 'Romane'];

/** Every Checkout Session the Worker asked Stripe for, as posted. */
const stripeSessions = [];

const worker = await startBuiltWorker({
  vars: { CANONICAL_ORIGIN: ORIGIN, SECRETS_KEK, AUTH_SECRET },
  async outbound(request) {
    const url = new URL(request.url);
    if (url.hostname === 'api.stripe.com' && url.pathname === '/v1/checkout/sessions') {
      stripeSessions.push(new URLSearchParams(await request.text()));
      const id = `cs_test_comment${stripeSessions.length}`;
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
  const lastOrder = () => db.prepare('SELECT public_id, buyer_comment FROM orders ORDER BY id DESC LIMIT 1').first();
  const lastReservation = () =>
    db
      .prepare('SELECT public_id, buyer_comment, status FROM checkout_reservations ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .first();
  const reservationCount = async () => (await db.prepare('SELECT COUNT(*) AS n FROM checkout_reservations').first()).n;
  const reservationById = (publicId) =>
    db.prepare('SELECT buyer_comment, status FROM checkout_reservations WHERE public_id = ?').bind(publicId).first();

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

  assert.equal((await post('/api/cart', { _action: 'add', product_id: PRODUCT })).status, 303);

  console.log('Le réglage, éteint par défaut');

  await check('a shop that has not switched it on asks for no comment and reads none', async () => {
    const cart = await (await get('/cart')).text();
    assert.ok(!cart.includes('name="order_comment"'), 'the cart asks for a comment');
    assert.equal((await (await fetch('/api/checkout')).json()).comment, null);
    // A posted one is not a reason for the 307 that carries a comment on.
    const started = await post('/api/checkout', { method: 'demo', source: 'cart', order_comment: 'Gaspard' });
    assert.equal(started.status, 303, `expected a plain redirect, got ${started.status}`);
    const refused = await postJson({
      items: [{ product_id: PRODUCT, quantity: 1 }],
      method: 'demo',
      ship_to: ADDRESS,
      comment: 'Gaspard',
    });
    assert.equal(refused.status, 400, 'a comment sent to a shop that takes none was dropped');
  });

  await check('the merchant switches it on in Réglages', async () => {
    assert.equal(login.status, 303, 'the admin login failed');
    const page = await (await adminGet('/admin/settings')).text();
    assert.ok(page.includes(t('admin.settings.feature.orderComment.label')), 'no switch in Réglages');
    const saved = await adminPost('/admin/settings', {
      _action: 'toggle_feature',
      feature: 'order_comment_enabled',
      enabled: '1',
    });
    assert.ok(saved.status < 400, `the switch answered ${saved.status}`);
    const stored = await db.prepare("SELECT value FROM settings WHERE key = 'order_comment_enabled'").first();
    assert.equal(stored?.value, '1');
  });

  console.log('La saisie');

  await check('the cart and Buy now ask for it, bounded', async () => {
    const field = new RegExp(`<textarea[^>]*name="order_comment"[^>]*maxlength="${ORDER_COMMENT_MAX_LENGTH}"`);
    assert.match(await (await get('/cart')).text(), field);
    assert.match(await (await get(`/express?product_id=${PRODUCT}`)).text(), field);
    assert.deepEqual((await (await fetch('/api/checkout')).json()).comment, { max_length: ORDER_COMMENT_MAX_LENGTH });
  });

  await check('a comment too long is refused before any stock is held, without its text in the URL', async () => {
    const before = await reservationCount();
    const refused = await post('/api/checkout', {
      method: 'demo',
      source: 'cart',
      order_comment: `Romane ${'x'.repeat(ORDER_COMMENT_MAX_LENGTH)}`,
    });
    assert.equal(refused.status, 303);
    const to = new URL(refused.headers.get('location'), ORIGIN);
    assert.equal(to.pathname, '/cart');
    assert.equal(to.searchParams.get('error'), t('checkout.comment.tooLong', { max: ORDER_COMMENT_MAX_LENGTH }));
    assert.ok(!refused.headers.get('location').includes('Romane'), 'the refused text went into the URL');
    assert.equal(await reservationCount(), before);
  });

  console.log('La commande');

  await check('the cart’s comment reaches the paid order through a 307, never a URL', async () => {
    const body = { method: 'demo', source: 'cart', order_comment: TYPED };
    const start = await post('/api/checkout', body);
    assert.equal(start.status, 307, `expected the body to be posted on, got ${start.status}`);
    const next = start.headers.get('location');
    assert.ok(next.startsWith('/checkout?') && next.includes('hop=start'), next);
    assert.ok(!next.includes('L%C3%A9a') && !next.includes('Léa'), 'the comment went into a URL');

    const placed = await post(next, body);
    const reservation = await lastReservation();
    assert.equal(reservation.buyer_comment, KEPT, 'the reservation does not carry the comment as kept');
    const pending = await db.prepare('SELECT items FROM pending_payments ORDER BY rowid DESC LIMIT 1').first();
    assert.ok(!pending.items.includes('Léa'), 'the pending payment copied the comment');

    const orderPage = await approve(placed);
    assert.equal((await lastOrder()).buyer_comment, KEPT);
    const settled = await reservationById(reservation.public_id);
    assert.equal(settled.status, 'settled');
    assert.equal(settled.buyer_comment, null, 'the settled reservation kept the comment');

    const html = await (await get(orderPage)).text();
    assert.ok(html.includes(t('order.comment')), 'the order page has no comment section');
    assert.ok(html.includes(ESCAPED), 'the order page does not read the comment back, escaped');
    assert.ok(!html.includes('<b>Zoé</b>'), 'the buyer’s text was rendered as markup');
  });

  await check('the JSON checkout reads `comment`, judges it, and echoes it', async () => {
    const wrongShape = await postJson({ items: [{ product_id: PRODUCT, quantity: 1 }], method: 'demo', ship_to: ADDRESS, comment: 3 });
    assert.equal(wrongShape.status, 400);
    const tooLong = await postJson({
      items: [{ product_id: PRODUCT, quantity: 1 }],
      method: 'demo',
      ship_to: ADDRESS,
      comment: 'x'.repeat(ORDER_COMMENT_MAX_LENGTH + 1),
    });
    assert.equal(tooLong.status, 400);
    assert.equal((await tooLong.json()).comment_max_length, ORDER_COMMENT_MAX_LENGTH);

    const placed = await postJson({
      items: [{ product_id: PRODUCT, quantity: 1 }],
      method: 'demo',
      ship_to: ADDRESS,
      comment: '  Pour Inès  ',
    });
    assert.equal(placed.status, 200, await placed.clone().text());
    assert.equal((await placed.json()).comment, 'Pour Inès');
    assert.equal((await lastReservation()).buyer_comment, 'Pour Inès');
  });

  await check('the Lightning page, which settles from its pending row, keeps the comment', async () => {
    const publicId = crypto.randomUUID();
    const item = { productId, name: 'Sac à dos', priceCents: 4500, quantity: 1 };
    assert.equal(
      await reserveInventory(db, publicId, [item], 600, 'lightning', undefined, undefined, null, null, null, null, 'Pour Tom'),
      true,
    );
    const order = pendingToPaidOrder({
      id: 1,
      public_id: publicId,
      payment_hash: `ln-${publicId}`,
      backend: 'phoenixd',
      bolt11: null,
      amount_sat: null,
      amount_total_cents: 4500,
      currency: 'eur',
      email: ADDRESS.email,
      items: JSON.stringify([{ id: productId, q: 1, n: 'Sac à dos', p: 4500 }]),
      shipping_cents: 0,
      ship_address: null,
      reservation_id: publicId,
      status: 'pending',
      expires_at: null,
      created_at: '2026-11-03 00:00:00',
    });
    assert.ok(await recordPaidOrder(db, order));
    assert.equal((await lastOrder()).buyer_comment, 'Pour Tom');
    assert.equal((await reservationById(publicId)).buyer_comment, null);
  });

  await check('a released reservation lets the comment go at once', async () => {
    const publicId = crypto.randomUUID();
    const item = { productId, name: 'Sac à dos', priceCents: 4500, quantity: 1 };
    assert.equal(
      await reserveInventory(db, publicId, [item], 600, 'demo', undefined, undefined, null, null, null, null, 'Pour Tom'),
      true,
    );
    assert.equal(await releaseInventoryReservation(db, publicId), true);
    const released = await reservationById(publicId);
    assert.equal(released.status, 'released');
    assert.equal(released.buyer_comment, null);
  });

  console.log('Les étapes de /checkout');

  // A transfer closes the demo rail; its /checkout has every step a buyer types in.
  await setting('bank_transfer_holder', 'Atelier Essai SARL');
  await setting('bank_transfer_iban', 'FR7630006000011234567890189');
  // The paid demo order emptied the cart.
  assert.equal((await post('/api/cart', { _action: 'add', product_id: PRODUCT })).status, 303);

  await check('the address step brings the cart’s comment back, editable', async () => {
    const html = await (await post('/checkout?hop=start', { method: 'bank_transfer', source: 'cart', order_comment: TYPED })).text();
    assert.match(html, /<textarea[^>]*name="order_comment"[^>]*>Prénom à broder : Léa\n\nMerci beaucoup &lt;b&gt;Zoé&lt;\/b&gt;<\/textarea>/);
  });

  await check('a comment too long on the address step is said, kept as typed, and holds nothing', async () => {
    const before = await reservationCount();
    const long = `Romane ${'x'.repeat(ORDER_COMMENT_MAX_LENGTH)}`;
    const html = await (await post('/checkout', { method: 'bank_transfer', ...ADDRESS, order_comment: long })).text();
    assert.ok(html.includes(t('checkout.comment.tooLong', { max: ORDER_COMMENT_MAX_LENGTH })), 'the refusal is not said');
    assert.ok(html.includes(`>${long}</textarea>`), 'the refused comment was not brought back to shorten');
    assert.equal(await reservationCount(), before);
  });

  await check('the rate step carries it hidden and recaps it; the order step holds it', async () => {
    const step = await (await post('/checkout', { method: 'bank_transfer', ...ADDRESS, order_comment: TYPED })).text();
    assert.ok(step.includes('name="shipping_label"'), 'the rate step did not render');
    // Inside a quoted attribute only `"` and `&` need escaping; Astro leaves `<` as is.
    const hidden = step.match(/<input type="hidden" name="order_comment" value="([^"]*)"/);
    assert.ok(hidden, 'the rate step does not carry the comment');
    assert.equal(hidden[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'), KEPT);
    assert.ok(step.includes(t('checkout.comment.yours')), 'the rate step does not recap the comment');
    // « Modifier l'adresse » posts, so the comment goes back with it.
    assert.match(step, /formaction="\/checkout\?hop=start"/);

    const label = step.match(/name="shipping_label" value="([^"]+)"/)[1];
    const placed = await post('/checkout', {
      method: 'bank_transfer',
      ...ADDRESS,
      order_comment: KEPT,
      shipping_label: label.replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
    });
    assert.equal(placed.status, 303, `the transfer was not placed: ${placed.status}`);
    assert.equal((await lastReservation()).buyer_comment, KEPT);
  });

  console.log('Le paiement par carte');

  await check('a card payment holds the comment, and Stripe’s session never sees it', async () => {
    await setting('enc:stripe_secret_key', await encryptSecret(SECRETS_KEK, 'sk_test_order_comment'));
    await setting('enc:stripe_webhook_secret', await encryptSecret(SECRETS_KEK, 'whsec_order_comment'));
    const started = await post('/api/checkout', { method: 'stripe', source: 'cart', country: 'FR', order_comment: 'Pour Gaspard' });
    assert.equal(started.status, 303, `the card checkout did not start: ${started.status}`);
    assert.equal((await lastReservation()).buyer_comment, 'Pour Gaspard');
    assert.equal(stripeSessions.length, 1);
    for (const [key, value] of stripeSessions[0]) assert.ok(!value.includes('Gaspard'), `the comment went into ${key}`);
  });

  console.log('L’administration');

  await check('the order page shows the merchant the comment, escaped', async () => {
    const commented = await db.prepare('SELECT public_id FROM orders WHERE buyer_comment = ?').bind(KEPT).first();
    const page = await adminGet(`/admin/orders/${commented.public_id}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes(t('admin.orders.detail.buyerComment')), 'no comment block on the admin order page');
    assert.ok(html.includes(ESCAPED), 'the admin order page does not show the comment, escaped');
    assert.ok(!html.includes('<b>Zoé</b>'), 'the buyer’s text was rendered as markup');
  });

  await check('no word a buyer wrote reached a log line', async () => {
    const logs = worker.logs();
    for (const word of WORDS) assert.ok(!logs.includes(word), `"${word}" was logged`);
  });
} finally {
  await worker.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nLe commentaire de l’acheteur suit chaque chemin de la commande, et seulement elle.');
