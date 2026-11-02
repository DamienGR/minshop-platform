/**
 * Customisable products (ticket #125, ADR 0022), on the built Worker.
 *
 * The rules a buyer's text is judged by are a unit
 * (features/products/customization.ts); what only the pipeline shows is that
 * every way into a sale carries that text to the order line, and lets it go
 * everywhere else: the cart cookie and the cart page, the demo rail through to
 * the paid order, a personalised Buy now through /express and /checkout
 * without the text ever being a URL, the JSON checkout, Stripe's hosted page,
 * and the Lightning page that settles from its pending row. That a line
 * refused (a blank required field, a text too long) never reaches the cart.
 * And that the admin editor writes the fields, while an order keeps the label
 * it was sold under.
 *
 * Run: node --experimental-strip-types test/integration/customization.mjs
 * (after a build — `npm run verify` builds first.)
 */
import assert from 'node:assert/strict';
import { startBuiltWorker } from '../helpers/built-worker.mjs';
import { encryptSecret } from '../../src/features/secrets/crypto.ts';
import { t } from '../../src/features/i18n/index.ts';
import { customizationText } from '../../src/features/products/customization.ts';
import { releaseInventoryReservation, reserveInventory } from '../../src/features/orders/reservations.ts';
import { recordPaidOrder } from '../../src/features/orders/db.ts';
import { pendingToPaidOrder } from '../../src/features/payments/lightning/pending.ts';
import { hashPassword } from '../../src/features/auth/password.ts';

const ORIGIN = 'https://store.test';
const SECRETS_KEK = 'customization-suite-key-encryption-key';
const AUTH_SECRET = 'customization-suite-auth-secret';
const PASSWORD = 'customization-suite-admin-password';
const FORM = 'application/x-www-form-urlencoded';
const PRODUCT = 'prod_prs0000001';
const NAME_FIELD = 'cfld_brd0000001';
const MESSAGE_FIELD = 'cfld_msg0000001';
const NAME = `custom:${NAME_FIELD}`;
const MESSAGE = `custom:${MESSAGE_FIELD}`;
const ADDRESS = {
  email: 'acheteuse@exemple.fr',
  name: 'Camille Essai',
  line1: '3 quai Ceineray',
  city: 'Nantes',
  postal: '44000',
  country: 'FR',
};
/** The texts buyers type here: none may reach a URL or a log line. */
const TYPED = ['Léa', 'Tom', 'Zoé', 'Inès', 'Joyeux anniversaire'];
const line = (value) => customizationText({ label: 'Nom à broder', value });

/** Every Checkout Session the Worker asked Stripe for, as posted. */
const stripeSessions = [];

const worker = await startBuiltWorker({
  vars: { CANONICAL_ORIGIN: ORIGIN, SECRETS_KEK, AUTH_SECRET },
  async outbound(request) {
    const url = new URL(request.url);
    if (url.hostname === 'api.stripe.com' && url.pathname === '/v1/checkout/sessions') {
      stripeSessions.push(new URLSearchParams(await request.text()));
      const id = `cs_test_custom${stripeSessions.length}`;
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
  const secret = async (name, value) => setting(`enc:${name}`, await encryptSecret(SECRETS_KEK, value));
  await setting('setup_complete', '1');
  await db
    .prepare(
      `INSERT INTO products (public_id, name, slug, description, price_cents, currency, stock, active)
       VALUES (?, 'Sac brodé', 'sac-brode', '', 3500, 'eur', 50, 1)`,
    )
    .bind(PRODUCT)
    .run();
  const productId = (await db.prepare('SELECT id FROM products WHERE public_id = ?').bind(PRODUCT).first()).id;
  await db
    .prepare(
      `INSERT INTO product_custom_fields (public_id, product_id, label, help_text, max_length, required, position)
       VALUES (?, ?, 'Nom à broder', 'En lettres capitales ou minuscules', 15, 1, 0),
              (?, ?, 'Message', NULL, 40, 0, 1)`,
    )
    .bind(NAME_FIELD, productId, MESSAGE_FIELD, productId)
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
  const post = async (path, fields, headers = {}) =>
    keep(
      await fetch(path, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': FORM, cookie: cookie(), ...headers },
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
  const add = (fields, headers) => post('/api/cart', { _action: 'add', product_id: PRODUCT, ...fields }, headers);
  /** Approve the demo payment a 303 to /pay/… points at; the order page's path. */
  const approve = async (placed) => {
    assert.equal(placed.status, 303, `the order was not placed: ${placed.status}`);
    const pay = await post(new URL(placed.headers.get('location'), ORIGIN).pathname, { outcome: 'approve' });
    assert.equal(pay.status, 303, `the demo payment did not settle: ${pay.status}`);
    return new URL(pay.headers.get('location'), ORIGIN).pathname;
  };
  const lastOrderItems = async () =>
    (
      await db
        .prepare(
          `SELECT name, customization FROM order_items
            WHERE order_id = (SELECT MAX(id) FROM orders) ORDER BY id`,
        )
        .all()
    ).results;
  const lastReservation = () =>
    db.prepare('SELECT items, customization, status FROM checkout_reservations ORDER BY created_at DESC, rowid DESC LIMIT 1').first();
  const reservationById = (publicId) =>
    db.prepare('SELECT items, customization, status FROM checkout_reservations WHERE public_id = ?').bind(publicId).first();

  console.log('La fiche produit');

  await check('shows each field with its help and its limit, and Buy now posts', async () => {
    const html = await (await get('/products/sac-brode')).text();
    assert.match(html, new RegExp(`<input[^>]*name="${NAME}"[^>]*maxlength="15"[^>]*required`));
    assert.match(html, new RegExp(`<input[^>]*name="${MESSAGE}"[^>]*maxlength="40"`));
    assert.ok(!new RegExp(`<input[^>]*name="${MESSAGE}"[^>]*required`).test(html), 'the optional field was required');
    assert.ok(html.includes('En lettres capitales ou minuscules'), 'the help text is missing');
    assert.ok(html.includes(t('product.customization.maxLength', { max: 15 })), 'the limit is not said');
    assert.match(html, /formaction="\/express"[^>]*formmethod="POST"|formmethod="POST"[^>]*formaction="\/express"/);
  });

  console.log('Le panier');

  await check('refuses a required field left blank, and a text too long', async () => {
    const blank = await add({ [NAME]: '   ' });
    assert.equal(blank.status, 303);
    const to = new URL(blank.headers.get('location'), ORIGIN);
    assert.equal(to.pathname, '/products/sac-brode');
    assert.equal(to.searchParams.get('error'), t('product.error.customRequired', { champ: 'Nom à broder' }));
    const long = await add({ [NAME]: 'Anne-Charlotte Dupont' });
    assert.equal(
      new URL(long.headers.get('location'), ORIGIN).searchParams.get('error'),
      t('product.error.customTooLong', { champ: 'Nom à broder', max: 15 }),
    );
    assert.ok(!long.headers.get('location').includes('Anne'), 'the refused text went into the URL');
    // The drawer's request: a 422 its script answers by posting the page.
    assert.equal((await add({ [NAME]: '' }, { 'x-partial': '1' })).status, 422);
    assert.ok(!jar.has('cart'), 'a refused line reached the cart');
  });

  await check('the same text is one line, another text a second one', async () => {
    assert.equal((await add({ [NAME]: 'Léa' })).status, 303);
    assert.equal((await add({ [NAME]: '  Léa ' })).status, 303);
    assert.equal((await add({ [NAME]: 'Tom', [MESSAGE]: 'Joyeux anniversaire' })).status, 303);
    const items = JSON.parse(decodeURIComponent(jar.get('cart'))).items;
    assert.deepEqual(Object.values(items).sort(), [1, 2]);
    assert.ok(!jar.get('cart').includes('L%C3%A9a'), 'the cookie carries the text in clear');
  });

  await check('the cart page reads each line’s text back', async () => {
    const html = await (await get('/cart')).text();
    assert.ok(html.includes(line('Léa')), 'the first line’s text is not shown');
    assert.ok(html.includes(line('Tom')), 'the second line’s text is not shown');
    assert.ok(html.includes(customizationText({ label: 'Message', value: 'Joyeux anniversaire' })));
  });

  await check('a cart line whose field turned required since stops at the cart', async () => {
    await db.prepare('UPDATE product_custom_fields SET required = 1 WHERE public_id = ?').bind(MESSAGE_FIELD).run();
    try {
      const html = await (await get('/cart')).text();
      assert.ok(html.includes(line('Tom')), 'the line that answers both fields went missing');
      assert.ok(!html.includes(line('Léa')), 'a line missing a now-required answer is still for sale');
    } finally {
      await db.prepare('UPDATE product_custom_fields SET required = 0 WHERE public_id = ?').bind(MESSAGE_FIELD).run();
    }
  });

  console.log('La commande');

  await check('the demo rail carries each line’s text to the paid order, and nowhere else', async () => {
    const placed = await post('/checkout', { method: 'demo', ...ADDRESS });
    const reservation = await lastReservation();
    assert.ok(!reservation.items.includes('Léa'), 'the text sits in the items the reservation keeps');
    assert.equal(JSON.parse(reservation.customization).length, 2, 'the reservation lost a line’s text');
    const pending = await db.prepare('SELECT items FROM pending_payments ORDER BY rowid DESC LIMIT 1').first();
    assert.ok(!pending.items.includes('Léa'), 'the pending payment copied the text');

    const orderPage = await approve(placed);
    const items = await lastOrderItems();
    assert.equal(items.length, 2);
    for (const item of items) assert.equal(item.name, 'Sac brodé', 'the text went into the line’s name');
    const texts = items.map((item) => JSON.parse(item.customization));
    assert.deepEqual(texts.flat().map((e) => e.value).sort(), ['Joyeux anniversaire', 'Léa', 'Tom']);
    const settled = await lastReservation();
    assert.equal(settled.status, 'settled');
    assert.equal(settled.customization, null, 'the settled reservation kept the text');

    const html = await (await get(orderPage)).text();
    assert.ok(html.includes(line('Léa')) && html.includes(line('Tom')), 'the order page does not show the text');
  });

  await check('a personalised Buy now goes through /express and /checkout without a URL', async () => {
    const express = await post('/express', { product_id: PRODUCT, [NAME]: 'Zoé' });
    assert.equal(express.status, 200, `/express answered ${express.status}`);
    const html = await express.text();
    assert.match(html, new RegExp(`<input type="hidden" name="${NAME}" value="Zoé"`));
    assert.ok(html.includes(line('Zoé')), '/express does not read the text back');

    const body = { method: 'demo', product_id: PRODUCT, [NAME]: 'Zoé' };
    const start = await post('/api/checkout', body);
    assert.equal(start.status, 307, `expected the body to be posted on, got ${start.status}`);
    const next = start.headers.get('location');
    assert.ok(next.startsWith('/checkout?') && next.includes('hop=start'), next);
    assert.ok(!next.includes('Zo'), 'the buyer’s text went into a URL');

    const placed = await post(next, body);
    await approve(placed);
    const [item] = await lastOrderItems();
    assert.deepEqual(JSON.parse(item.customization), [{ label: 'Nom à broder', value: 'Zoé' }]);
  });

  await check('Buy now refuses a blank required field before any stock is held', async () => {
    const before = await db.prepare('SELECT COUNT(*) AS n FROM checkout_reservations').first();
    const refused = await post('/api/checkout', { method: 'demo', product_id: PRODUCT });
    assert.equal(refused.status, 303);
    assert.equal(new URL(refused.headers.get('location'), ORIGIN).pathname, '/products/sac-brode');
    const after = await db.prepare('SELECT COUNT(*) AS n FROM checkout_reservations').first();
    assert.equal(after.n, before.n);
  });

  await check('the JSON checkout reads `customization`, and says what it needs', async () => {
    const detail = await (await fetch('/api/products/sac-brode')).json();
    assert.deepEqual(detail.customization_fields, [
      { id: NAME_FIELD, label: 'Nom à broder', help: 'En lettres capitales ou minuscules', max_length: 15, required: true },
      { id: MESSAGE_FIELD, label: 'Message', help: null, max_length: 40, required: false },
    ]);

    const missing = await postJson({ items: [{ slug: 'sac-brode', quantity: 1 }], method: 'demo', ship_to: ADDRESS });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).customization_fields[0].id, NAME_FIELD);
    const wrongShape = await postJson({
      items: [{ slug: 'sac-brode', quantity: 1, customization: { [NAME_FIELD]: 3 } }],
      method: 'demo',
      ship_to: ADDRESS,
    });
    assert.equal(wrongShape.status, 400);

    const placed = await postJson({
      items: [{ slug: 'sac-brode', quantity: 1, customization: { [NAME_FIELD]: 'Inès' } }],
      method: 'demo',
      ship_to: ADDRESS,
    });
    assert.equal(placed.status, 200, await placed.clone().text());
    assert.deepEqual((await placed.json()).items[0].customization, [{ label: 'Nom à broder', value: 'Inès' }]);
    assert.equal(JSON.parse((await lastReservation()).customization)[0][0].value, 'Inès');
  });

  await check('the Lightning page, which settles from its pending row, keeps the text', async () => {
    const publicId = crypto.randomUUID();
    const entries = [{ label: 'Nom à broder', value: 'Léa' }];
    const item = { productId, name: 'Sac brodé', priceCents: 3500, quantity: 1, customization: entries };
    assert.equal(await reserveInventory(db, publicId, [item], 600, 'lightning'), true);
    // The pending row's compact item list is all settleLightningOnLoad passes.
    const order = pendingToPaidOrder({
      id: 1,
      public_id: publicId,
      payment_hash: `ln-${publicId}`,
      backend: 'phoenixd',
      bolt11: null,
      amount_sat: null,
      amount_total_cents: 3500,
      currency: 'eur',
      email: ADDRESS.email,
      items: JSON.stringify([{ id: productId, q: 1, n: 'Sac brodé', p: 3500 }]),
      shipping_cents: 0,
      ship_address: null,
      reservation_id: publicId,
      status: 'pending',
      expires_at: null,
      created_at: '2026-11-02 00:00:00',
    });
    assert.ok(await recordPaidOrder(db, order));
    const [stored] = await lastOrderItems();
    assert.deepEqual(JSON.parse(stored.customization), entries);
    assert.equal((await reservationById(publicId)).customization, null);
  });

  await check('a released reservation lets the text go at once', async () => {
    const publicId = crypto.randomUUID();
    const item = {
      productId,
      name: 'Sac brodé',
      priceCents: 3500,
      quantity: 1,
      customization: [{ label: 'Nom à broder', value: 'Tom' }],
    };
    assert.equal(await reserveInventory(db, publicId, [item], 600, 'demo'), true);
    assert.ok((await reservationById(publicId)).customization);
    assert.equal(await releaseInventoryReservation(db, publicId), true);
    const released = await reservationById(publicId);
    assert.equal(released.status, 'released');
    assert.equal(released.customization, null);
  });

  await check('Stripe’s page shows the text under the item, and its metadata never carries it', async () => {
    // A real rail closes the demo one: Stripe last.
    await secret('stripe_secret_key', 'sk_test_customization');
    await secret('stripe_webhook_secret', 'whsec_customization');
    const started = await post('/api/checkout', { method: 'stripe', product_id: PRODUCT, country: 'FR', [NAME]: 'Léa' });
    assert.equal(started.status, 303, `the card checkout did not start: ${started.status}`);
    const [session] = stripeSessions;
    assert.equal(session.get('line_items[0][price_data][product_data][name]'), 'Sac brodé');
    assert.equal(session.get('line_items[0][price_data][product_data][description]'), line('Léa'));
    for (const [key, value] of session) {
      if (key !== 'line_items[0][price_data][product_data][description]') {
        assert.ok(!value.includes('Léa'), `the text went into ${key}`);
      }
    }
  });

  console.log('L’administration');

  await db
    .prepare("INSERT INTO settings (key, value) VALUES ('admin_password_hash', ?)")
    .bind(await hashPassword(PASSWORD))
    .run();
  const login = await fetch('/admin/login', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': FORM },
    body: new URLSearchParams({ password: PASSWORD }).toString(),
  });
  const session = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const adminGet = (path) => fetch(path, { headers: { cookie: session } });
  const adminPost = (path, body) =>
    fetch(path, { method: 'POST', headers: { origin: ORIGIN, 'content-type': FORM, cookie: session }, body: body.toString() });
  /** The product form as the editor posts it: the product, then one entry per field row. */
  const editorForm = (rows, remove = []) => {
    const form = new URLSearchParams({
      name: 'Sac brodé',
      slug: 'sac-brode',
      price: '35',
      stock: '50',
      currency: 'eur',
      active: 'on',
      requires_shipping: 'on',
    });
    for (const row of rows) {
      form.append('c_id', row.id ?? '');
      form.append('c_label', row.label);
      form.append('c_help', row.help ?? '');
      form.append('c_max', String(row.max));
      form.append('c_required', row.required ? '1' : '0');
    }
    for (const id of remove) form.append('c_remove', id);
    return form;
  };
  const storedFields = async () =>
    (
      await db
        .prepare(
          'SELECT public_id, label, help_text, max_length, required, position FROM product_custom_fields WHERE product_id = ? ORDER BY position',
        )
        .bind(productId)
        .all()
    ).results;
  const zoeOrder = async () =>
    db
      .prepare(
        "SELECT o.public_id FROM orders o JOIN order_items i ON i.order_id = o.id WHERE i.customization LIKE '%Zoé%'",
      )
      .first();

  await check('the order page shows the merchant each line’s text', async () => {
    assert.equal(login.status, 303, 'the admin login failed');
    const page = await adminGet(`/admin/orders/${(await zoeOrder()).public_id}`);
    assert.equal(page.status, 200);
    assert.ok((await page.text()).includes(line('Zoé')), 'the order page does not show the text');
  });

  await check('the editor lists the fields, and saves a rename, a new field and a removal', async () => {
    const editor = await (await adminGet(`/admin/products/${PRODUCT}/edit`)).text();
    assert.ok(editor.includes('id="personnalisation"'), 'the editor has no personalisation section');
    assert.match(editor, new RegExp(`name="c_id" value="${NAME_FIELD}"`));
    assert.match(editor, new RegExp(`name="c_remove" value="${MESSAGE_FIELD}"`));

    const saved = await adminPost(
      `/api/admin/products/${PRODUCT}`,
      editorForm(
        [
          { id: NAME_FIELD, label: 'Prénom à broder', help: 'En lettres capitales ou minuscules', max: 12, required: true },
          { id: MESSAGE_FIELD, label: 'Message', max: 40, required: false },
          { label: 'Date', help: 'JJ/MM/AAAA', max: 10, required: false },
        ],
        [MESSAGE_FIELD],
      ),
    );
    assert.equal(saved.status, 303);
    assert.equal(new URL(saved.headers.get('location'), ORIGIN).pathname, '/admin/products', saved.headers.get('location'));
    const fields = await storedFields();
    assert.equal(fields.length, 2, JSON.stringify(fields));
    assert.deepEqual(fields[0], {
      public_id: NAME_FIELD,
      label: 'Prénom à broder',
      help_text: 'En lettres capitales ou minuscules',
      max_length: 12,
      required: 1,
      position: 0,
    });
    const { public_id: created, ...added } = fields[1];
    assert.match(created, /^cfld_[0-9a-hjkmnp-tv-z]{10}$/);
    // Positions are the rows' places in the editor, the removed one's included.
    assert.deepEqual(added, { label: 'Date', help_text: 'JJ/MM/AAAA', max_length: 10, required: 0, position: 2 });

    const html = await (await get('/products/sac-brode')).text();
    assert.match(html, new RegExp(`<input[^>]*name="${NAME}"[^>]*maxlength="12"`));
    assert.ok(!html.includes(`name="${MESSAGE}"`), 'the removed field is still asked');
  });

  await check('an order keeps the label it was sold under', async () => {
    const html = await (await adminGet(`/admin/orders/${(await zoeOrder()).public_id}`)).text();
    assert.ok(html.includes(line('Zoé')), 'renaming the field rewrote the order');
  });

  await check('the editor refuses a maximum past 200, with nothing written', async () => {
    const refused = await adminPost(
      `/api/admin/products/${PRODUCT}`,
      editorForm([{ id: NAME_FIELD, label: 'Prénom', max: 500, required: true }]),
    );
    assert.equal(refused.status, 303);
    const to = new URL(refused.headers.get('location'), ORIGIN);
    assert.equal(to.pathname, `/admin/products/${PRODUCT}/edit`);
    assert.equal(
      to.searchParams.get('error'),
      t('admin.products.customization.error.row', {
        numero: 1,
        erreur: t('admin.products.customization.error.maxLength', { max: 200 }),
      }),
    );
    assert.equal((await storedFields())[0].label, 'Prénom à broder');
  });

  await check('no text a buyer typed reached a log line', async () => {
    const logs = worker.logs();
    for (const typed of TYPED) assert.ok(!logs.includes(typed), `"${typed}" was logged`);
  });
} finally {
  await worker.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nLe texte de personnalisation suit chaque chemin de la commande, et seulement elle.');
