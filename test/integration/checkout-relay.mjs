/**
 * The relay point step of /checkout (ticket #123, plan §13.3, lot 4), on the
 * built Worker.
 *
 * What only the pipeline shows: that a relay rate reaches the rate step only
 * while Boxtal can search and buy, and only where its search finds a point;
 * that the point a shopper posts is believed only if the shop served it; that
 * the search is asked once per address and offer; and that the point rides the
 * reservation to the paid order, with `delivery_method` = `relay`. The pieces
 * are units of their own (features/shipping/relay.ts, the calculator).
 *
 * Boxtal answers with the search recorded in its sandbox (test/fixtures/boxtal/
 * `02`: Mondial Relay around Paris 11e). The option is switched on by the
 * `RELAY_POINTS` var, as on a staging that rehearses it.
 *
 * Run: node --experimental-strip-types test/integration/checkout-relay.mjs
 * (after a build — `npm run verify` builds first.)
 */
import assert from 'node:assert/strict';
import { startBuiltWorker } from '../helpers/built-worker.mjs';
import { recorded } from '../helpers/boxtal-corpus.mjs';
import { encryptSecret } from '../../src/features/secrets/crypto.ts';
import { saveRuntimeShippingConfig } from '../../src/features/shipping/settings.ts';
import { t } from '../../src/features/i18n/index.ts';

const ORIGIN = 'https://store.test';
const SECRETS_KEK = 'checkout-relay-suite-key-encryption-key';
const FORM = 'application/x-www-form-urlencoded';
const PRODUCT = 'prod_rxy0000001';
const ADDRESS = {
  email: 'acheteur@exemple.fr',
  name: 'Dominique Essai',
  line1: '12 rue Pache',
  city: 'Paris',
  postal: '75011',
  country: 'FR',
  // From the ranges ARCEP keeps for fiction: it reaches nobody.
  phone: '06 39 98 00 02',
};
const MONDIAL = recorded('02-parcel-points-by-offer-mondial-relay').response.body;
const MONDIAL_CODES = MONDIAL.content.map((entry) => entry.parcelPoint.code);

/** Searches Boxtal was asked, by offer. */
const searches = {};
let openNodeCharges = 0;

const worker = await startBuiltWorker({
  vars: { CANONICAL_ORIGIN: ORIGIN, SECRETS_KEK, RELAY_POINTS: 'on' },
  async outbound(request) {
    const url = new URL(request.url);
    if (url.hostname === 'api.boxtal.build' && url.pathname === '/shipping/v3.2/parcel-point-by-shipping-offer') {
      const offer = url.searchParams.get('shippingOfferCode');
      searches[offer] = (searches[offer] ?? 0) + 1;
      // Mondial Relay answers; Chronopost is down, as a provider sometimes is.
      if (offer === 'MONR-CpourToi') return Response.json(MONDIAL);
      return Response.json({ status: 500, errors: [] }, { status: 500 });
    }
    if (url.hostname === 'api.opennode.com' && url.pathname === '/v1/charges') {
      const id = `charge_relay_${++openNodeCharges}`;
      return Response.json({ data: { id, hosted_checkout_url: `https://checkout.opennode.com/${id}` } });
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
       VALUES (?, 'Théière en fonte', 'theiere-en-fonte', '', 3900, 'eur', 50, 1)`,
    )
    .bind(PRODUCT)
    .run();
  const saved = await saveRuntimeShippingConfig(db, 0, {
    enabled: true,
    packageWeightGrams: 0,
    zones: [
      {
        name: 'France',
        countries: ['FR'],
        freeOverCents: null,
        rates: [
          { label: 'Colissimo à domicile', pricing: { type: 'flat', amountCents: 690 } },
          {
            label: 'Mondial Relay',
            pricing: { type: 'relay', offer: 'MONR-CpourToi', price: { type: 'flat', amountCents: 390 } },
          },
          {
            label: 'Chrono Relais',
            pricing: { type: 'relay', offer: 'CHRP-ChronoRelais', price: { type: 'flat', amountCents: 490 } },
          },
        ],
      },
    ],
  });
  assert.equal(saved.ok, true, 'the shipping document was refused');

  const post = (fields) =>
    fetch('/checkout', {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': FORM },
      body: new URLSearchParams(fields).toString(),
    });
  const reservations = async () => (await db.prepare('SELECT COUNT(*) AS n FROM checkout_reservations').first()).n;
  const rateLabels = (html) => [...html.matchAll(/name="shipping_label" value="([^"]+)"/g)].map((m) => m[1]);
  const pointCodes = (html) => [...html.matchAll(/name="relay_point" value="([^"]+)"/g)].map((m) => m[1]);
  // OpenNode, a real rail: its rate step is not skipped as the demo's is.
  const openNode = { method: 'opennode', product_id: PRODUCT, ...ADDRESS };
  await secret('opennode_api_key', 'checkout-relay-suite-opennode');

  console.log('Sans les clés Boxtal');

  await check('no relay rate is offered, and Boxtal is never asked', async () => {
    const html = await (await post(openNode)).text();
    assert.deepEqual(rateLabels(html), ['Colissimo à domicile']);
    assert.deepEqual(searches, {});
  });

  // The v3 pair is what searches and buys; its values never leave the stub.
  await secret('boxtal_access_key', 'checkout-relay-suite-access');
  await secret('boxtal_secret_key', 'checkout-relay-suite-secret');

  console.log('Avec les clés Boxtal');

  await check('a relay rate is offered where its search finds a point, and only there', async () => {
    worker.clearLogs();
    const page = await post(openNode);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.deepEqual(rateLabels(html), ['Colissimo à domicile', 'Mondial Relay']);
    assert.ok(html.includes(t('checkout.relay.rateHint')), 'the relay rate does not say it is a relay');
    // Chronopost's search failed: its rate leaves the choice, the order goes on.
    assert.equal(searches['CHRP-ChronoRelais'], 1);
    assert.match(worker.logs(), /"event":"relay_points_unavailable","offer":"CHRP-ChronoRelais"/);
    assert.ok(!worker.logs().includes('75011'), 'the address reached the log');
  });

  await check('a relay rate leads to the points, and reserves nothing yet', async () => {
    const before = await reservations();
    const html = await (await post({ ...openNode, shipping_label: 'Mondial Relay' })).text();
    assert.deepEqual(pointCodes(html), MONDIAL_CODES);
    assert.ok(html.includes('ART THE ZEN'), 'the nearest point is not named');
    assert.ok(html.includes(t('checkout.relay.choose')));
    assert.match(html, /<input type="hidden" name="shipping_label" value="Mondial Relay"/);
    assert.equal(await reservations(), before, 'stock was held before a point was chosen');
  });

  await check('the search is asked once per address and offer', async () => {
    // Three rate steps so far, a spaced postcode now: one search all along.
    await post({ ...openNode, postal: '75 011' });
    assert.equal(searches['MONR-CpourToi'], 1);
  });

  await check('a point the shop did not serve is refused', async () => {
    const before = await reservations();
    const html = await (await post({ ...openNode, shipping_label: 'Mondial Relay', relay_point: '99999' })).text();
    assert.ok(html.includes(t('checkout.error.relayPointGone')), 'a forged point was not named as gone');
    assert.deepEqual(pointCodes(html), MONDIAL_CODES);
    assert.equal(await reservations(), before);
    assert.equal(openNodeCharges, 0);
  });

  await check('going back to the rates keeps the relay rate selected', async () => {
    const html = await (await post({ ...openNode, shipping_label: 'Mondial Relay', change_rate: '1' })).text();
    assert.deepEqual(rateLabels(html), ['Colissimo à domicile', 'Mondial Relay']);
    assert.match(html, /name="shipping_label" value="Mondial Relay" checked/);
    assert.deepEqual(pointCodes(html), []);
  });

  await check('the chosen point rides the reservation, and the rate says relay', async () => {
    const placed = await post({ ...openNode, shipping_label: 'Mondial Relay', relay_point: MONDIAL_CODES[0] });
    assert.equal(placed.status, 303, `the order was not placed: ${placed.status}`);
    assert.equal(openNodeCharges, 1);
    const pending = await db
      .prepare('SELECT reservation_id, delivery_method, shipping_cents, shipping_label FROM pending_payments ORDER BY rowid DESC LIMIT 1')
      .first();
    assert.equal(pending.delivery_method, 'relay');
    assert.equal(pending.shipping_cents, 390);
    assert.equal(pending.shipping_label, 'Mondial Relay');
    const reservation = await db
      .prepare('SELECT relay_point FROM checkout_reservations WHERE public_id = ?')
      .bind(pending.reservation_id)
      .first();
    assert.deepEqual(JSON.parse(reservation.relay_point), {
      offer: 'MONR-CpourToi',
      code: '41132',
      name: 'ART THE ZEN',
      street: '5 RUE PACHE',
      postalCode: '75011',
      city: 'PARIS',
      country: 'FR',
    });
  });

  await check('a home rate carries no point', async () => {
    const placed = await post({ ...openNode, shipping_label: 'Colissimo à domicile', relay_point: MONDIAL_CODES[0] });
    assert.equal(placed.status, 303);
    const pending = await db
      .prepare('SELECT reservation_id, delivery_method FROM pending_payments ORDER BY rowid DESC LIMIT 1')
      .first();
    assert.equal(pending.delivery_method, 'shipping');
    const reservation = await db
      .prepare('SELECT relay_point FROM checkout_reservations WHERE public_id = ?')
      .bind(pending.reservation_id)
      .first();
    assert.equal(reservation.relay_point, null);
  });

  await db.prepare("DELETE FROM settings WHERE key = 'enc:opennode_api_key'").run();

  await check('the paid order keeps the point, copied from the reservation', async () => {
    const demo = { method: 'demo', product_id: PRODUCT, ...ADDRESS };
    const placed = await post({ ...demo, shipping_label: 'Mondial Relay', relay_point: MONDIAL_CODES[1] });
    assert.equal(placed.status, 303, `the demo order was not placed: ${placed.status}`);
    const pay = await fetch(new URL(placed.headers.get('location')).pathname, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': FORM },
      body: new URLSearchParams({ outcome: 'approve' }).toString(),
    });
    assert.equal(pay.status, 303, `the demo payment did not settle: ${pay.status}`);
    const order = await db
      .prepare('SELECT delivery_method, relay_point, ship_address FROM orders ORDER BY id DESC LIMIT 1')
      .first();
    assert.equal(order.delivery_method, 'relay');
    assert.equal(JSON.parse(order.relay_point).code, MONDIAL_CODES[1]);
    // The buyer stays the label's recipient and contact.
    assert.equal(JSON.parse(order.ship_address).phone, ADDRESS.phone);
  });
} finally {
  await worker.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nLe point relais choisi à la commande arrive jusqu’à la commande payée.');
