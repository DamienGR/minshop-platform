/**
 * Payment by bank transfer (ticket #146, ADR 0023), on the built Worker.
 *
 * The IBAN's check digits, the reference and the delay are units
 * (features/payments/bankTransfer.ts); what only the pipeline shows is the
 * whole wait: the settings refuse a mistyped IBAN, the cart offers the
 * transfer once the account is set, /checkout leads to the transfer page with
 * the stock held for the delay set, the buyer and the merchant each get their
 * e-mail, the admin lists the transfers awaited, and the merchant's two words
 * end each one — « Virement reçu » writes the paid order through
 * recordPaidOrder, « Abandonner » puts the stock back on sale. The deadline
 * releases the stock by the cron's sweep, and a transfer recorded past it
 * takes the stock back. The JSON checkout hands an agent the account. And no
 * buyer's address reaches a log line.
 *
 * Run: node --experimental-strip-types test/integration/bank-transfer.mjs
 * (after a build — `npm run verify` builds first.)
 */
import assert from 'node:assert/strict';
import { startBuiltWorker } from '../helpers/built-worker.mjs';
import { encryptSecret } from '../../src/features/secrets/crypto.ts';
import { t } from '../../src/features/i18n/index.ts';
import { hashPassword } from '../../src/features/auth/password.ts';
import { releaseExpiredReservations } from '../../src/features/orders/reservations.ts';
import { formatIban, transferReference } from '../../src/features/payments/bankTransfer.ts';

const ORIGIN = 'https://store.test';
const SECRETS_KEK = 'bank-transfer-suite-key-encryption-key';
const AUTH_SECRET = 'bank-transfer-suite-auth-secret';
const PASSWORD = 'bank-transfer-suite-admin-password';
const FORM = 'application/x-www-form-urlencoded';
const PRODUCT = 'prod_vrm0000001';
const STOCK = 6;
const IBAN = 'FR7630006000011234567890189';
const HOLDER = 'Atelier Essai SARL';
const BIC = 'AGRIFRPP';
const MERCHANT = 'boutique@exemple.fr';
const ADDRESS = {
  email: 'acheteur-virement@exemple.fr',
  name: 'Camille Virement',
  line1: '3 quai Ceineray',
  city: 'Nantes',
  postal: '44000',
  country: 'FR',
};
const DAY = 24 * 60 * 60 * 1000;

/** Every e-mail the Worker asked Resend to send, as posted. */
const emails = [];

const worker = await startBuiltWorker({
  vars: { CANONICAL_ORIGIN: ORIGIN, SECRETS_KEK, AUTH_SECRET },
  async outbound(request) {
    const url = new URL(request.url);
    if (url.hostname === 'api.resend.com') {
      emails.push(await request.json());
      return Response.json({ id: `bank-transfer-email-${emails.length}` });
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
  await setting('enc:resend_api_key', await encryptSecret(SECRETS_KEK, 're_bank_transfer_key'));
  await setting('email_enabled', '1');
  await setting('email_provider', 'resend');
  await setting('email_from', 'commandes@exemple.fr');
  await setting('email_notify_to', MERCHANT);
  await db
    .prepare(
      `INSERT INTO products (public_id, name, slug, description, price_cents, currency, stock, active, weight_grams)
       VALUES (?, 'Bol en grès', 'bol-en-gres', '', 4200, 'eur', ?, 1, 400)`,
    )
    .bind(PRODUCT, STOCK)
    .run();
  const stock = async () =>
    (await db.prepare('SELECT stock FROM products WHERE public_id = ?').bind(PRODUCT).first()).stock;

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
  const path = (response) => new URL(response.headers.get('location'), ORIGIN).pathname;

  const login = await fetch('/admin/login', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': FORM },
    body: new URLSearchParams({ password: PASSWORD }).toString(),
  });
  assert.equal(login.status, 303, 'the admin login failed');
  const session = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const adminGet = (to) => fetch(to, { headers: { cookie: session } });
  const adminPost = (to, fields, headers = {}) =>
    fetch(to, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': FORM, cookie: session, ...headers },
      body: new URLSearchParams(fields).toString(),
    });
  /** The settings card's save, as its script posts it. */
  const saveAccount = (fields) =>
    adminPost('/admin/settings', { _action: 'save_bank_transfer', ...fields }, { 'x-requested-with': 'fetch' });
  const decide = (action, publicId) => adminPost('/api/admin/bank-transfers', { _action: action, transfer: publicId });

  /** Basket → /checkout → address → rate → the transfer page. The pending row. */
  const placeTransfer = async (quantity = 1) => {
    jar.clear();
    for (let i = 0; i < quantity; i++) {
      assert.equal((await post('/api/cart', { _action: 'add', product_id: PRODUCT })).status, 303);
    }
    const start = await post('/api/checkout', { method: 'bank_transfer' });
    assert.ok([303, 307].includes(start.status), `the cart did not hand over to /checkout: ${start.status}`);
    assert.equal(path(start), '/checkout');
    const fields = { method: 'bank_transfer', ...ADDRESS };
    const rates = await post('/checkout', fields);
    assert.equal(rates.status, 200, `the address step answered ${rates.status}`);
    const label = (await rates.text()).match(/name="shipping_label" value="([^"]+)"/)?.[1];
    assert.ok(label, 'no shipping rate was offered');
    const placed = await post('/checkout', { ...fields, shipping_label: label.replaceAll('&amp;', '&') });
    assert.equal(placed.status, 303, `the order was not placed: ${placed.status}`);
    const payPath = path(placed);
    assert.match(payPath, /^\/pay\/otk_/, `the checkout went elsewhere: ${payPath}`);
    const pending = await db
      .prepare("SELECT * FROM pending_payments WHERE backend = 'bank_transfer' ORDER BY id DESC LIMIT 1")
      .first();
    return { payPath, token: payPath.slice('/pay/'.length), pending };
  };
  const reservation = (publicId) =>
    db
      .prepare('SELECT payment_method, status, expires_at FROM checkout_reservations WHERE public_id = ?')
      .bind(publicId)
      .first();
  const orderOf = (publicId) =>
    db
      .prepare('SELECT id, public_id, payment_method, status, amount_total_cents FROM orders WHERE provider_session_id = ?')
      .bind(`bank_transfer_${publicId}`)
      .first();
  /** The outbox delivers after the response: wait for it, briefly. */
  const until = async (predicate, what) => {
    for (let i = 0; i < 40; i++) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(`${what} never happened`);
  };
  const recipients = (message) => [message.to].flat();

  console.log('Les réglages');

  await check('the cart offers the demo, not the transfer, before an account is set', async () => {
    assert.equal((await post('/api/cart', { _action: 'add', product_id: PRODUCT })).status, 303);
    const html = await (await get('/cart')).text();
    assert.ok(html.includes('value="demo"'), 'the demo rail is not offered');
    assert.ok(!html.includes('value="bank_transfer"'), 'the transfer is offered without an account');
  });

  await check('refuse an IBAN whose check digits are wrong, and a holder left blank', async () => {
    const typo = await saveAccount({ bank_transfer_holder: HOLDER, bank_transfer_iban: 'FR7630006000011234567890188' });
    assert.equal(typo.status, 400);
    assert.equal(await typo.text(), t('admin.settings.payments.bankTransfer.error.iban'));
    const anonymous = await saveAccount({ bank_transfer_holder: '', bank_transfer_iban: IBAN });
    assert.equal(anonymous.status, 400);
    assert.equal(await anonymous.text(), t('admin.settings.payments.bankTransfer.error.holder'));
    const days = await saveAccount({ bank_transfer_holder: HOLDER, bank_transfer_iban: IBAN, bank_transfer_days: '45' });
    assert.equal(days.status, 400);
    const stored = await db.prepare("SELECT value FROM settings WHERE key = 'bank_transfer_iban'").first();
    assert.equal(stored, null, 'a refused account was saved');
  });

  await check('save the account as typed with spaces, and the cart offers the transfer alone', async () => {
    const saved = await saveAccount({
      bank_transfer_holder: HOLDER,
      bank_transfer_iban: formatIban(IBAN).toLowerCase(),
      bank_transfer_bic: BIC,
      bank_transfer_days: '8',
    });
    assert.equal(saved.status, 204, `the save answered ${saved.status}: ${await saved.clone().text()}`);
    const stored = await db.prepare("SELECT value FROM settings WHERE key = 'bank_transfer_iban'").first();
    assert.equal(stored.value, IBAN);
    const days = await db.prepare("SELECT value FROM settings WHERE key = 'bank_transfer_days'").first();
    assert.equal(days, null, 'the default delay was stored as if chosen');
    const page = await (await adminGet('/admin/settings')).text();
    assert.ok(page.includes(formatIban(IBAN)), 'the settings page does not read the IBAN back');

    const html = await (await get('/cart')).text();
    assert.ok(html.includes('value="bank_transfer"'), 'the transfer is not offered');
    assert.ok(!html.includes('value="demo"'), 'a real rail did not withdraw the demo');
  });

  console.log('La commande');

  const first = await placeTransfer();
  const reference = transferReference(first.pending.public_id);

  await check('the checkout ends on the transfer page: account, amount, reference, deadline', async () => {
    const page = await get(first.payPath);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'private, no-store');
    const html = await page.text();
    assert.ok(html.includes('data-bank-transfer="awaited"'), 'the page is not the awaited transfer');
    assert.ok(html.includes(formatIban(IBAN)), 'the IBAN is not shown in groups of four');
    assert.ok(html.includes(HOLDER) && html.includes(BIC), 'the holder or the BIC is missing');
    assert.match(html, new RegExp(`data-transfer-reference>${reference}<`));
    assert.ok(html.includes(t('pay.transfer.emailed', { email: ADDRESS.email })), 'the page does not say the copy went out');
    assert.ok(!jar.has('cart') || !decodeURIComponent(jar.get('cart')).includes(PRODUCT), 'the basket was not emptied');
  });

  await check('a pending row and a reservation held for eight days, never an order', async () => {
    assert.equal(first.pending.status, 'pending');
    assert.equal(first.pending.email, ADDRESS.email);
    assert.equal(first.pending.reservation_id, first.pending.public_id);
    assert.ok(first.pending.shipping_cents > 0, 'the rate chosen was not charged');
    assert.equal(first.pending.amount_total_cents, 4200 + first.pending.shipping_cents);
    const held = await reservation(first.pending.public_id);
    assert.equal(held.payment_method, 'bank_transfer');
    assert.equal(held.status, 'active');
    const lasts = Date.parse(`${held.expires_at.replace(' ', 'T')}Z`) - Date.now();
    assert.ok(Math.abs(lasts - 8 * DAY) < 60_000, `the hold lasts ${Math.round(lasts / DAY)} days`);
    assert.equal(Date.parse(first.pending.expires_at), Date.parse(`${held.expires_at.replace(' ', 'T')}Z`));
    assert.equal(await orderOf(first.pending.public_id), null, 'an unpaid order was written');
    assert.equal(await stock(), STOCK - 1);
  });

  await check('the buyer gets the page by e-mail, the merchant the notice', async () => {
    const buyer = emails.filter((m) => recipients(m).includes(ADDRESS.email));
    const merchant = emails.filter((m) => recipients(m).includes(MERCHANT));
    assert.equal(buyer.length, 1, `the buyer got ${buyer.length} e-mail(s)`);
    assert.equal(merchant.length, 1, `the merchant got ${merchant.length} e-mail(s)`);
    assert.ok(buyer[0].subject.includes(reference), buyer[0].subject);
    for (const part of [formatIban(IBAN), HOLDER, BIC, reference, `${ORIGIN}${first.payPath}`]) {
      assert.ok(buyer[0].text.includes(part), `the buyer's e-mail lacks ${part}`);
    }
    assert.ok(merchant[0].subject.includes(reference), merchant[0].subject);
    assert.ok(merchant[0].text.includes(`${ORIGIN}/admin/orders#bank-transfers`), 'the notice does not link the list');
    assert.ok(!merchant[0].text.includes(IBAN), 'the notice repeats the account');
  });

  await check('/order/<token> sends a transfer still awaited back to its page', async () => {
    const order = await get(`/order/${first.token}`);
    assert.equal(order.status, 303);
    assert.equal(path(order), first.payPath);
  });

  await check('the orders page opens on the transfers awaited, with both actions', async () => {
    const html = await (await adminGet('/admin/orders')).text();
    assert.ok(html.includes('id="bank-transfers"'), 'no list of the transfers awaited');
    assert.ok(html.includes(`data-awaited-transfer="${first.pending.public_id}"`), 'the transfer is not listed');
    assert.ok(html.includes(reference) && html.includes(ADDRESS.email));
    assert.ok(html.includes('value="received"') && html.includes('value="abandon"'));
  });

  await check('« Virement reçu » writes the paid order, its confirmation, once', async () => {
    const sentBefore = emails.length;
    const received = await decide('received', first.pending.public_id);
    assert.equal(received.status, 303);
    const order = await orderOf(first.pending.public_id);
    assert.ok(order, 'no order was written');
    assert.equal(path(received), `/admin/orders/${order.public_id}`);
    assert.equal(order.payment_method, 'bank_transfer');
    assert.equal(order.amount_total_cents, first.pending.amount_total_cents);
    const settled = await db
      .prepare('SELECT status FROM pending_payments WHERE public_id = ?')
      .bind(first.pending.public_id)
      .first();
    assert.equal(settled.status, 'settled');
    assert.equal((await reservation(first.pending.public_id)).status, 'settled');
    assert.equal(await stock(), STOCK - 1, 'the stock was taken twice');
    await until(
      () => emails.slice(sentBefore).some((m) => recipients(m).includes(ADDRESS.email)),
      'the order confirmation',
    );

    const again = await decide('received', first.pending.public_id);
    assert.equal(again.status, 303);
    assert.equal(path(again), `/admin/orders/${order.public_id}`, 'a second click did not land on the order');
    const count = await db
      .prepare('SELECT COUNT(*) AS n FROM orders WHERE provider_session_id = ?')
      .bind(`bank_transfer_${first.pending.public_id}`)
      .first();
    assert.equal(count.n, 1);
  });

  await check('the transfer page then leads to the order, which says how it was paid', async () => {
    const pay = await get(first.payPath);
    assert.equal(pay.status, 303);
    assert.equal(path(pay), `/order/${first.token}`);
    const html = await (await get(`/order/${first.token}`)).text();
    assert.ok(html.includes(t('payment.method.bankTransfer')), 'the order page does not name the transfer');
    const list = await (await adminGet('/admin/orders')).text();
    assert.ok(!list.includes(`data-awaited-transfer="${first.pending.public_id}"`), 'a recorded transfer is still awaited');
  });

  console.log('L’abandon et l’échéance');

  await check('« Abandonner » puts the stock back, and the transfer can no longer be recorded', async () => {
    const second = await placeTransfer(2);
    assert.equal(await stock(), STOCK - 3);
    const abandoned = await decide('abandon', second.pending.public_id);
    assert.equal(abandoned.status, 303);
    assert.equal(await stock(), STOCK - 1, 'the stock was not put back on sale');
    assert.equal((await reservation(second.pending.public_id)).status, 'released');
    const html = await (await get(second.payPath)).text();
    assert.ok(html.includes('data-bank-transfer="abandoned"'), 'the page does not say the order is cancelled');
    assert.ok(!html.includes(formatIban(IBAN)), 'a cancelled order still shows the account');

    const late = await decide('received', second.pending.public_id);
    assert.equal(late.status, 303);
    const to = new URL(late.headers.get('location'), ORIGIN);
    assert.equal(to.pathname, '/admin/orders');
    assert.equal(
      to.searchParams.get('error'),
      t('admin.orders.transfers.error.gone', { reference: transferReference(second.pending.public_id) }),
    );
    assert.equal(await orderOf(second.pending.public_id), null, 'an abandoned transfer became an order');
  });

  const third = await placeTransfer();

  await check('the deadline releases the stock by the sweep, and the page says so', async () => {
    assert.equal(await stock(), STOCK - 2);
    // Eight days later, as the cron finds it.
    await db
      .prepare("UPDATE checkout_reservations SET expires_at = datetime('now', '-1 minute') WHERE public_id = ?")
      .bind(third.pending.public_id)
      .run();
    await db
      .prepare('UPDATE pending_payments SET expires_at = ? WHERE public_id = ?')
      .bind(new Date(Date.now() - 60_000).toISOString(), third.pending.public_id)
      .run();
    await releaseExpiredReservations(db);
    assert.equal((await reservation(third.pending.public_id)).status, 'expired');
    assert.equal(await stock(), STOCK - 1, 'the deadline did not put the stock back');
    const html = await (await get(third.payPath)).text();
    assert.ok(html.includes('data-bank-transfer="overdue"'), 'the page does not say the deadline passed');
    const list = await (await adminGet('/admin/orders')).text();
    assert.ok(list.includes(`data-awaited-transfer="${third.pending.public_id}"`), 'an overdue transfer left the list');
    assert.match(
      list,
      new RegExp(`<li[^>]*data-awaited-transfer="${third.pending.public_id}"[^>]*data-overdue="1"`),
      'the list does not mark it overdue',
    );
  });

  await check('a transfer recorded past its deadline takes the stock back', async () => {
    const received = await decide('received', third.pending.public_id);
    assert.equal(received.status, 303);
    const order = await orderOf(third.pending.public_id);
    assert.ok(order, 'the late transfer was not recorded');
    assert.equal(path(received), `/admin/orders/${order.public_id}`);
    assert.equal(await stock(), STOCK - 2, 'the late order did not take its stock back');
  });

  await check('a late transfer short of stock becomes an inventory exception', async () => {
    const fourth = await placeTransfer();
    await db
      .prepare("UPDATE checkout_reservations SET expires_at = datetime('now', '-1 minute') WHERE public_id = ?")
      .bind(fourth.pending.public_id)
      .run();
    await releaseExpiredReservations(db);
    // Sold elsewhere meanwhile.
    await db.prepare('UPDATE products SET stock = 0 WHERE public_id = ?').bind(PRODUCT).run();
    const received = await decide('received', fourth.pending.public_id);
    assert.equal(received.status, 303);
    const order = await orderOf(fourth.pending.public_id);
    assert.ok(order, 'the late transfer was not recorded');
    const exception = await db
      .prepare('SELECT COUNT(*) AS n FROM order_inventory_exceptions WHERE order_id = ?')
      .bind(order.id)
      .first();
    assert.equal(exception.n, 1, 'the shortfall was not flagged');
    await db.prepare('UPDATE products SET stock = ? WHERE public_id = ?').bind(STOCK, PRODUCT).run();
  });

  await check('a basket that ships nothing skips /checkout, and the page asks the e-mail', async () => {
    await db
      .prepare(
        `INSERT INTO products (public_id, name, slug, description, price_cents, currency, stock, active, requires_shipping)
         VALUES ('prod_vrm0000002', 'Bon cadeau', 'bon-cadeau', '', 3000, 'eur', 10, 1, 0)`,
      )
      .run();
    jar.clear();
    assert.equal((await post('/api/cart', { _action: 'add', product_id: 'prod_vrm0000002' })).status, 303);
    const placed = await post('/api/checkout', { method: 'bank_transfer' });
    assert.equal(placed.status, 303);
    const payPath = path(placed);
    assert.match(payPath, /^\/pay\/otk_/, `the basket went elsewhere: ${payPath}`);
    const pending = await db
      .prepare("SELECT public_id, email, amount_total_cents FROM pending_payments WHERE backend = 'bank_transfer' ORDER BY id DESC LIMIT 1")
      .first();
    assert.equal(pending.email, null);
    assert.equal(pending.amount_total_cents, 3000);
    const html = await (await get(payPath)).text();
    assert.ok(html.includes('data-bank-transfer="awaited"') && html.includes('name="email"'), 'the page asks no e-mail');
    assert.ok(html.includes(t('pay.transfer.noteIt')), 'the page claims a copy went out');

    const refused = await post(payPath, { email: 'pas-une-adresse' });
    assert.equal(refused.status, 200);
    assert.ok((await refused.text()).includes(t('pay.transfer.email.invalid')));
    const sentBefore = emails.length;
    const given = await post(payPath, { email: 'cadeau-virement@exemple.fr' });
    assert.equal(given.status, 303);
    assert.equal(path(given), payPath);
    const stored = await db.prepare('SELECT email FROM pending_payments WHERE public_id = ?').bind(pending.public_id).first();
    assert.equal(stored.email, 'cadeau-virement@exemple.fr');
    const copy = emails.slice(sentBefore).filter((m) => recipients(m).includes('cadeau-virement@exemple.fr'));
    assert.equal(copy.length, 1, 'the copy was not sent once');
    assert.ok(copy[0].text.includes(transferReference(pending.public_id)));
    const after = await (await get(payPath)).text();
    assert.ok(!after.includes('name="email"'), 'the page still asks the e-mail');
    // A second post cannot replace the address the copy went to.
    await post(payPath, { email: 'autre@exemple.fr' });
    const kept = await db.prepare('SELECT email FROM pending_payments WHERE public_id = ?').bind(pending.public_id).first();
    assert.equal(kept.email, 'cadeau-virement@exemple.fr');
  });

  console.log('L’API');

  await check('the JSON checkout hands an agent the account, the amount and the reference', async () => {
    const placed = await fetch('/api/checkout', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ items: [{ slug: 'bol-en-gres', quantity: 1 }], method: 'bank_transfer', ship_to: ADDRESS }),
    });
    assert.equal(placed.status, 200, await placed.clone().text());
    const body = await placed.json();
    assert.equal(body.flow, 'bank_transfer');
    assert.equal(body.bank_transfer.iban, IBAN);
    assert.equal(body.bank_transfer.holder, HOLDER);
    assert.equal(body.bank_transfer.bic, BIC);
    const pending = await db
      .prepare("SELECT public_id, amount_total_cents FROM pending_payments WHERE backend = 'bank_transfer' ORDER BY id DESC LIMIT 1")
      .first();
    assert.equal(body.bank_transfer.reference, transferReference(pending.public_id));
    assert.equal(body.bank_transfer.amount_cents, pending.amount_total_cents);
    assert.ok(Date.parse(body.bank_transfer.expires_at) - Date.now() > 7 * DAY, body.bank_transfer.expires_at);
    assert.match(body.checkout_url, /\/pay\/otk_/);
  });

  await check('no buyer’s address reached a log line', async () => {
    for (const email of [ADDRESS.email, 'cadeau-virement@exemple.fr']) {
      assert.ok(!worker.logs().includes(email), `${email} was logged`);
    }
  });
} finally {
  await worker.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nLe virement attendu tient le stock, et seul le commerçant en fait une commande.');
