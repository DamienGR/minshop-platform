/**
 * A rate's instructions for the buyer (ticket #237) and the pickup made ready
 * to collect (ticket #238), on the built Worker.
 *
 * The rules are units of their own (the shipping document, the calculator,
 * the e-mails, the outbox). What only the pipeline shows: that the text is
 * read under its rate at /checkout, rendered and escaped as a page is; that
 * every way into a sale copies it onto the order — the rails that settle from
 * their pending row, the JSON checkout, and a card, through the chosen Stripe
 * rate's metadata, a zone with instructions taking the card through /checkout
 * first; that the order page reads it back; and that the admin order page of a
 * pickup makes it ready to collect, without a carrier, queueing the ready
 * notice and never the shipped one, while a delivery keeps its form.
 *
 * Run: node --experimental-strip-types test/integration/shipping-instructions.mjs
 * (after a build — `npm run verify` builds first.)
 */
import assert from 'node:assert/strict';
import { startBuiltWorker } from '../helpers/built-worker.mjs';
import { encryptSecret } from '../../src/features/secrets/crypto.ts';
import { hashPassword } from '../../src/features/auth/password.ts';
import { saveRuntimeShippingConfig } from '../../src/features/shipping/settings.ts';
import { t } from '../../src/features/i18n/index.ts';

const ORIGIN = 'https://store.test';
const SECRETS_KEK = 'shipping-instructions-suite-key-encryption-key';
const WEBHOOK_SECRET = 'whsec_shipping_instructions';
const AUTH_SECRET = 'shipping-instructions-suite-auth-secret';
const PASSWORD = 'shipping-instructions-suite-password';
const FORM = 'application/x-www-form-urlencoded';
const PRODUCT = 'prod_nst0000001';
const ADDRESS = {
  email: 'acheteur@exemple.fr',
  name: 'Dominique Essai',
  line1: '3 quai Ceineray',
  city: 'Nantes',
  postal: '44000',
  country: 'FR',
};
const PICKUP = 'Retrait à l’atelier';
const HOME = 'Colissimo à domicile';
/** The merchant's Markdown: bold, a list, a link on the shop, markup typed as text. */
const INSTRUCTIONS =
  'Au **12 rue des Lilas**, au fond de la cour.\n\n- le mercredi, 14 h – 18 h\n- sinon, [écrivez-nous](/pages/contact)\n\n<b>sonnez</b>';

/** Every Checkout Session the Worker asked Stripe for, as posted. */
const stripeSessions = [];
/** A posted session's one rate field, `shipping_options[0][shipping_rate_data]…`. */
const rateField = (session, name) => session.get(`shipping_options[0][shipping_rate_data]${name}`);

const worker = await startBuiltWorker({
  vars: { CANONICAL_ORIGIN: ORIGIN, SECRETS_KEK, AUTH_SECRET },
  async outbound(request) {
    const url = new URL(request.url);
    if (url.hostname === 'api.stripe.com' && url.pathname === '/v1/checkout/sessions') {
      stripeSessions.push(new URLSearchParams(await request.text()));
      const id = `cs_test_instr${stripeSessions.length}`;
      return Response.json({ id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    // The rate a session made, read back at settlement: what the shop posted.
    const rate = url.hostname === 'api.stripe.com' && url.pathname.match(/^\/v1\/shipping_rates\/shr_instr(\d+)$/);
    if (rate) {
      const posted = stripeSessions[Number(rate[1]) - 1];
      const metadata = Object.fromEntries(
        [...posted]
          .filter(([key]) => key.startsWith('shipping_options[0][shipping_rate_data][metadata]['))
          .map(([key, value]) => [key.slice('shipping_options[0][shipping_rate_data][metadata]['.length, -1), value]),
      );
      return Response.json({
        id: `shr_instr${rate[1]}`,
        object: 'shipping_rate',
        display_name: rateField(posted, '[display_name]'),
        metadata,
      });
    }
    return new Response('unexpected outbound call', { status: 502 });
  },
});

/** Stripe's scheme: HMAC-SHA256 over `<timestamp>.<payload>`, hex, as v1. */
async function stripeSignature(payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

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
  const secret = async (name, value) => setting(`enc:${name}`, await encryptSecret(SECRETS_KEK, value));
  await setting('setup_complete', '1');
  await setting('admin_password_hash', await hashPassword(PASSWORD));
  await db
    .prepare(
      `INSERT INTO products (public_id, name, slug, description, price_cents, currency, stock, active)
       VALUES (?, 'Bol en grès', 'bol-en-gres', '', 3900, 'eur', 50, 1)`,
    )
    .bind(PRODUCT)
    .run();
  const saved = await saveRuntimeShippingConfig(db, 0, {
    enabled: true,
    packageWeightGrams: 0,
    zones: [
      {
        name: 'Belgique',
        countries: ['BE'],
        freeOverCents: null,
        rates: [{ label: 'Bpost à domicile', pricing: { type: 'flat', amountCents: 990 } }],
      },
      {
        name: 'France',
        countries: ['FR'],
        freeOverCents: null,
        rates: [
          { label: HOME, pricing: { type: 'flat', amountCents: 690 } },
          { label: PICKUP, pricing: { type: 'pickup', amountCents: 0 }, instructions: INSTRUCTIONS },
        ],
      },
    ],
  });
  assert.equal(saved.ok, true, 'the shipping document was refused');
  const stored = await db.prepare("SELECT value FROM settings WHERE key = 'shipping_config'").first();
  assert.equal(JSON.parse(stored.value).schema, 6, 'a document with instructions is not written as version 6');

  const post = (path, fields) =>
    fetch(path, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': FORM },
      body: new URLSearchParams(fields).toString(),
    });
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
  const lastPending = () =>
    db.prepare('SELECT shipping_label, shipping_instructions FROM pending_payments ORDER BY rowid DESC LIMIT 1').first();
  const lastOrder = () =>
    db
      .prepare('SELECT id, public_id, shipping_label, shipping_instructions, delivery_method FROM orders ORDER BY id DESC LIMIT 1')
      .first();
  /** What the page shows of the instructions, rendered as a page renders Markdown. */
  const rendered = (html) => {
    assert.ok(html.includes('<strong>12 rue des Lilas</strong>'), 'the bold is not rendered');
    assert.ok(html.includes('<li>le mercredi, 14 h – 18 h</li>'), 'the list is not rendered');
    assert.match(html, /<a href="\/pages\/contact"[^>]*>écrivez-nous<\/a>/);
    // Markup typed as text stays text.
    assert.ok(html.includes('&lt;b&gt;sonnez&lt;/b&gt;'), 'raw HTML was not escaped');
    assert.ok(!html.includes('<b>sonnez</b>'), 'raw HTML was parsed');
  };

  console.log('Copiées sur la commande (ticket #237)');

  let pickupOrderPage = null;

  await check('a rail that settles from its pending row copies them to the order', async () => {
    const placed = await post('/checkout', { method: 'demo', product_id: PRODUCT, ...ADDRESS, shipping_label: PICKUP });
    assert.deepEqual(await lastPending(), { shipping_label: PICKUP, shipping_instructions: INSTRUCTIONS });
    pickupOrderPage = await approve(placed);
    const order = await lastOrder();
    assert.equal(order.shipping_label, PICKUP);
    assert.equal(order.delivery_method, 'pickup');
    assert.equal(order.shipping_instructions, INSTRUCTIONS);
  });

  await check('a rate without any leaves the order without a word', async () => {
    await approve(await post('/checkout', { method: 'demo', product_id: PRODUCT, ...ADDRESS, shipping_label: HOME }));
    const order = await lastOrder();
    assert.equal(order.shipping_label, HOME);
    assert.equal(order.shipping_instructions, null);
  });

  await check('the JSON checkout echoes them, and lists them beside an unknown rate', async () => {
    const unknown = await postJson({ items: [{ product_id: PRODUCT, quantity: 1 }], method: 'demo', ship_to: ADDRESS, shipping_label: 'Nulle part' });
    assert.equal(unknown.status, 400);
    const listed = (await unknown.json()).shipping_options;
    assert.deepEqual(listed.map((o) => o.instructions ?? null), [null, INSTRUCTIONS]);

    const placed = await postJson({ items: [{ product_id: PRODUCT, quantity: 1 }], method: 'demo', ship_to: ADDRESS, shipping_label: PICKUP });
    assert.equal(placed.status, 200, await placed.clone().text());
    assert.equal((await placed.json()).shipping_instructions, INSTRUCTIONS);
    assert.deepEqual(await lastPending(), { shipping_label: PICKUP, shipping_instructions: INSTRUCTIONS });
  });

  await check('the order page reads them back under « Livraison »', async () => {
    assert.ok(pickupOrderPage?.startsWith('/order/'), `no order page: ${pickupOrderPage}`);
    const html = await (await fetch(pickupOrderPage)).text();
    const section = html.match(/<section[^>]*data-order-delivery[^>]*>([\s\S]*?)<\/section>/);
    assert.ok(section, 'the order page has no delivery section');
    assert.ok(section[1].includes(`>${t('order.delivery')}<`), 'the section is not titled « Livraison »');
    assert.ok(section[1].includes(PICKUP), 'the rate is not named');
    rendered(section[1]);
  });

  console.log('Sous le tarif, à /checkout');

  // A transfer's /checkout has every step a buyer types in, the rate step
  // included. It closes the demo rail, so it comes after the demo orders.
  await setting('bank_transfer_holder', 'Atelier Essai SARL');
  await setting('bank_transfer_iban', 'FR7630006000011234567890189');

  await check('the rate step shows the instructions under their rate, and only there', async () => {
    const html = await (await post('/checkout', { method: 'bank_transfer', product_id: PRODUCT, ...ADDRESS })).text();
    const labels = [...html.matchAll(/name="shipping_label" value="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(labels, [HOME, PICKUP]);
    assert.equal(html.match(/data-rate-instructions/g)?.length, 1, 'one card holds instructions');
    // Tied to its radio, outside its label.
    assert.match(html, /value="Retrait à l’atelier"[^>]*aria-describedby="rate-instructions-1"/);
    assert.match(html, /<div id="rate-instructions-1" class="shipping-instructions[^"]*">/);
    rendered(html);
  });

  await check('a zone without instructions keeps its rates as they were', async () => {
    const html = await (
      await post('/checkout', { method: 'bank_transfer', product_id: PRODUCT, ...ADDRESS, country: 'BE', postal: '1000', city: 'Bruxelles' })
    ).text();
    assert.ok(html.includes('value="Bpost à domicile"'), 'the Belgian rate step did not render');
    assert.ok(!html.includes('data-rate-instructions'));
    assert.ok(!html.includes('aria-describedby="rate-instructions-'));
  });

  console.log('Par carte');

  await secret('stripe_secret_key', 'sk_test_shipping_instructions');
  await secret('stripe_webhook_secret', WEBHOOK_SECRET);
  const toStripe = (fields) => post('/api/checkout', { method: 'stripe', product_id: PRODUCT, ...fields });

  await check('a card payment to a zone with instructions goes through /checkout first', async () => {
    const sent = await toStripe({ country: 'FR' });
    assert.equal(sent.status, 303);
    const location = new URL(sent.headers.get('location'), ORIGIN);
    assert.equal(location.pathname, '/checkout');
    assert.equal(location.searchParams.get('method'), 'stripe');
    assert.equal(stripeSessions.length, 0, 'Stripe was asked before the buyer read the rates');
  });

  await check('a zone without any still goes straight to Stripe', async () => {
    const sent = await toStripe({ country: 'BE' });
    assert.equal(sent.status, 303);
    assert.match(sent.headers.get('location'), /^https:\/\/checkout\.stripe\.com\//);
  });

  let cardSession = 0;

  await check('Stripe gets the chosen rate alone, its instructions in its metadata', async () => {
    const placed = await post('/checkout', { method: 'stripe', product_id: PRODUCT, ...ADDRESS, shipping_label: PICKUP });
    assert.equal(placed.status, 303, `the card order was not handed to Stripe: ${placed.status}`);
    assert.match(placed.headers.get('location'), /^https:\/\/checkout\.stripe\.com\//);
    cardSession = stripeSessions.length;
    const session = stripeSessions[cardSession - 1];
    assert.equal(rateField(session, '[display_name]'), PICKUP);
    assert.equal(rateField(session, '[metadata][delivery]'), 'pickup');
    assert.equal(rateField(session, '[metadata][instructions]'), INSTRUCTIONS);
    assert.equal(session.get('shipping_options[1][shipping_rate_data][display_name]'), null, 'another rate was offered');
  });

  await check('the paid session settles an order that keeps them', async () => {
    const session = stripeSessions[cardSession - 1];
    const metadata = Object.fromEntries(
      [...session].filter(([key]) => key.startsWith('metadata[')).map(([key, value]) => [key.slice(9, -1), value]),
    );
    const payload = JSON.stringify({
      id: 'evt_shipping_instructions_1',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_test_instr${cardSession}`,
          object: 'checkout.session',
          currency: 'eur',
          payment_status: 'paid',
          payment_intent: 'pi_shipping_instructions_1',
          amount_total: 3900,
          customer_details: { email: ADDRESS.email, phone: null },
          metadata,
          total_details: { amount_shipping: 0, amount_discount: 0, amount_tax: 0 },
          shipping_cost: { amount_total: 0, shipping_rate: `shr_instr${cardSession}` },
        },
      },
    });
    const delivered = await fetch('/api/webhook/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': await stripeSignature(payload) },
      body: payload,
    });
    assert.equal(delivered.status, 200, `the webhook was refused: ${delivered.status}`);
    const order = await db
      .prepare('SELECT shipping_label, shipping_instructions, delivery_method FROM orders WHERE public_id = ?')
      .bind(metadata.public_id)
      .first();
    assert.ok(order, 'the paid session wrote no order');
    assert.deepEqual({ ...order }, { shipping_label: PICKUP, shipping_instructions: INSTRUCTIONS, delivery_method: 'pickup' });
  });

  console.log('Prête à retirer (ticket #238)');

  const login = await post('/admin/login', { password: PASSWORD });
  assert.equal(login.status, 303, 'the admin login failed');
  const session = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const adminGet = async (path) => (await fetch(path, { headers: { cookie: session } })).text();
  const adminPost = (path, fields) =>
    fetch(path, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': FORM, cookie: session },
      body: new URLSearchParams(fields).toString(),
    });
  const notificationKinds = async (orderId) =>
    (await db.prepare('SELECT kind FROM order_notifications WHERE order_id = ? ORDER BY kind').bind(orderId).all()).results.map(
      (row) => row.kind,
    );
  const orderRow = (publicId) =>
    db
      .prepare('SELECT id, fulfillment_status, tracking_carrier, tracking_number FROM orders WHERE public_id = ?')
      .bind(publicId)
      .first();
  const [pickupOrder, homeOrder] = await Promise.all([
    db.prepare("SELECT public_id FROM orders WHERE delivery_method = 'pickup' AND payment_method = 'demo' ORDER BY id LIMIT 1").first(),
    db.prepare("SELECT public_id FROM orders WHERE delivery_method = 'shipping' AND payment_method = 'demo' ORDER BY id LIMIT 1").first(),
  ]);
  /** The list's row of an order, by the link to its page. */
  const listRow = (html, publicId) => html.match(new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*?/admin/orders/${publicId}"[\\s\\S]*?</tr>`))?.[0] ?? '';

  await check('a pickup to prepare is made ready without a carrier', async () => {
    const html = await adminGet(`/admin/orders/${pickupOrder.public_id}`);
    assert.ok(html.includes(`>${t('admin.orders.detail.pickup')}<`), 'the section is not « Retrait »');
    assert.match(html, /<form[^>]*data-pickup-ready/);
    assert.ok(html.includes(t('admin.orders.detail.markReadyForPickup')));
    assert.ok(!html.includes('name="tracking_number"'), 'a pickup is asked for a tracking number');
    assert.ok(html.includes(t('admin.orders.detail.shippingInstructions')), 'the admin does not show what the buyer was told');
    assert.ok(listRow(await adminGet('/admin/orders'), pickupOrder.public_id).includes(t('admin.orders.fulfillment.toPrepare')));
  });

  await check('« Marquer comme prête à retirer » queues the ready notice, never the shipped one', async () => {
    // A form forged with a carrier changes nothing: a pickup has none.
    const done = await adminPost(`/api/admin/orders/${pickupOrder.public_id}`, {
      _action: 'fulfill',
      carrier: 'colissimo',
      tracking_number: '6A00000000000',
    });
    assert.equal(done.status, 303);
    const order = await orderRow(pickupOrder.public_id);
    assert.deepEqual(
      { ...order, id: undefined },
      { id: undefined, fulfillment_status: 'fulfilled', tracking_carrier: null, tracking_number: null },
    );
    const kinds = await notificationKinds(order.id);
    assert.ok(kinds.includes('order-pickup-ready'), `no ready notice queued: ${kinds}`);
    assert.ok(!kinds.includes('order-shipped'), 'a shipped notice was queued for a pickup');
  });

  await check('the order then reads « Prête à retirer », and can be made not ready', async () => {
    const html = await adminGet(`/admin/orders/${pickupOrder.public_id}`);
    assert.ok(html.includes(t('admin.orders.fulfillment.readyForPickup')));
    assert.ok(html.includes(t('admin.orders.detail.markNotReady')));
    assert.ok(listRow(await adminGet('/admin/orders'), pickupOrder.public_id).includes(t('admin.orders.fulfillment.readyForPickup')));
    // The filter's neutral word takes both modes.
    const processed = await adminGet('/admin/orders?fulfillment=fulfilled');
    assert.ok(processed.includes(`/admin/orders/${pickupOrder.public_id}"`), 'the ready pickup is not « Traitée »');
  });

  await check('a delivery keeps its carrier form and its shipped notice', async () => {
    const html = await adminGet(`/admin/orders/${homeOrder.public_id}`);
    assert.ok(html.includes('name="tracking_number"'), 'a delivery lost its tracking number');
    assert.ok(!html.includes('data-pickup-ready'));
    assert.ok(listRow(await adminGet('/admin/orders'), homeOrder.public_id).includes(t('admin.orders.fulfillment.unfulfilled')));
    const done = await adminPost(`/api/admin/orders/${homeOrder.public_id}`, {
      _action: 'fulfill',
      carrier: 'colissimo',
      tracking_number: '6A00000000001',
    });
    assert.equal(done.status, 303);
    const order = await orderRow(homeOrder.public_id);
    assert.equal(order.tracking_number, '6A00000000001');
    const kinds = await notificationKinds(order.id);
    assert.ok(kinds.includes('order-shipped'));
    assert.ok(!kinds.includes('order-pickup-ready'));
  });
} finally {
  await worker.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} shipping-instructions check(s) failed`);
  process.exit(1);
}
console.log('\nshipping-instructions: all checks passed');
