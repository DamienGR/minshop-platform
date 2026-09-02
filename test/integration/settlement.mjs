import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { applyMigrations } from '../helpers/d1-schema.mjs';
import { setWorkersEnv } from '../helpers/workers-env.mjs';

/**
 * The settlement lifecycle: a verified provider event in, an order (or the
 * absence of one) out, against a real D1 carrying every real migration.
 *
 * Jalon 7 of the pilot plan asks for a payment that can be taken and given
 * back "avec cohérence entre Stripe, D1, stock, admin et e-mails". Everything
 * on that path already existed and NONE of it was covered: no test built a
 * Stripe event, no test verified a signature, and no test had ever called
 * `recordPaidWebhookOrder` — the function that decides whether money becomes an
 * order. The sibling suites test the pieces it orchestrates (reservations,
 * refund accounting, the outbox state machine) in isolation; this one tests the
 * orchestration, which is where duplicate, late and out-of-order deliveries do
 * their damage.
 *
 * Events go through the REAL Stripe adapter, signed with a real HMAC: the
 * normalization the orchestrator consumes is the normalization Stripe's own
 * verifier produces, not a shape this file invented. The vendor stays where the
 * architecture puts it — behind the port — and the only fiction is the payload,
 * which is what a provider double is for.
 */

const ORIGIN = 'https://boutique.test';
const KEK = 'integration-kek-not-a-real-value';
const STRIPE_KEY = 'sk_test_double';
const WEBHOOK_SECRET = 'whsec_double';

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-07-20',
  d1Databases: ['DB'],
});

/** Restored in the outer finally; declared here so that finally can see it. */
let REAL_FETCH = globalThis.fetch;

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${err.stack ?? err.message}`);
  }
};

try {
  const db = await mf.getD1Database('DB');
  await applyMigrations(db);
  // Filled BEFORE the app modules load: several read `env` while evaluating.
  setWorkersEnv({ DB: db, SECRETS_KEK: KEK });

  const { recordPaidWebhookOrder } = await import('../../src/features/orders/recordWebhook.ts');
  const { createStripeProvider } = await import('../../src/features/payments/stripe.ts');
  const { claimOrderIdentity } = await import('../../src/features/orders/guestAccess.ts');
  const { reserveInventory } = await import('../../src/features/orders/reservations.ts');
  const { getStoreSettings, setSetting } = await import('../../src/features/settings/db.ts');
  const { setSecret } = await import('../../src/features/secrets/store.ts');
  const { deliverOrderNotifications } = await import('../../src/features/email/outbox.ts');
  const { vatIncludedCents } = await import('../../src/features/legal/vat.ts');

  // The rail has to be configured for the refund branch: it rebuilds the
  // provider to correlate a payment back to its session.
  await setSecret(db, 'stripe_secret_key', STRIPE_KEY);
  await setSecret(db, 'stripe_webhook_secret', WEBHOOK_SECRET);

  // Nothing in this suite may reach the network, and one path tries: the refund
  // correlation asks Stripe which session produced a payment. Left alone it is a
  // real HTTPS call that fails on a 401 (or hangs on an offline runner) and
  // turns an assertion about D1 into an assertion about connectivity. The guard
  // answers that one endpoint with an empty list — the honest answer for a
  // payment this store never took — and refuses everything else loudly.
  REAL_FETCH = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('https://api.stripe.com/v1/checkout/sessions')) {
      return new Response(JSON.stringify({ object: 'list', data: [], has_more: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`Unexpected outbound request in the settlement suite: ${url}`);
  };

  const provider = createStripeProvider(STRIPE_KEY, WEBHOOK_SECRET);

  // --- the provider double -------------------------------------------------

  const hex = (buffer) =>
    [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

  /** Stripe's scheme: HMAC-SHA256 over `<timestamp>.<payload>`, hex, as v1. */
  async function signatureHeader(payload, secret = WEBHOOK_SECRET) {
    const timestamp = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.${payload}`),
    );
    return `t=${timestamp},v1=${hex(mac)}`;
  }

  let eventSeq = 0;
  const eventId = () => `evt_${String(++eventSeq).padStart(6, '0')}`;

  /** Verify a signed event through the adapter and settle whatever it means. */
  async function deliver(event, { secret = WEBHOOK_SECRET, method = 'stripe' } = {}) {
    const payload = JSON.stringify(event);
    const headers = new Headers({ 'stripe-signature': await signatureHeader(payload, secret) });
    const result = await provider.verifyWebhook(payload, headers);
    await recordPaidWebhookOrder(result, ORIGIN, method, await getStoreSettings(db));
    return result;
  }

  const sessionEvent = (type, session) => ({
    id: eventId(),
    type,
    data: { object: { object: 'checkout.session', currency: 'eur', ...session } },
  });

  const paidSession = ({
    sessionId,
    reservationId,
    paymentIntent,
    amountTotal,
    email = 'cliente@exemple.fr',
    shippingCents = 0,
    discountCents = 0,
    taxCents = 0,
    paymentStatus = 'paid',
    rate = null,
  }) => ({
    id: sessionId,
    payment_status: paymentStatus,
    payment_intent: paymentIntent,
    amount_total: amountTotal,
    customer_details: { email },
    metadata: { public_id: reservationId, reservation_id: reservationId },
    total_details: {
      amount_shipping: shippingCents,
      amount_discount: discountCents,
      amount_tax: taxCents,
    },
    ...(rate && { shipping_cost: { amount_total: shippingCents, shipping_rate: rate } }),
    collected_information: {
      shipping_details: {
        name: 'Camille Durand',
        address: {
          line1: '12 rue des Lilas',
          line2: null,
          city: 'Nantes',
          state: null,
          postal_code: '44000',
          country: 'FR',
        },
      },
    },
  });

  const refundEvent = ({ paymentIntent, chargeId, cumulativeCents, currency = 'eur', id }) => ({
    id: id ?? eventId(),
    type: 'charge.refunded',
    data: {
      object: {
        object: 'charge',
        id: chargeId,
        payment_intent: paymentIntent,
        amount_refunded: cumulativeCents,
        currency,
      },
    },
  });

  // --- fixtures ------------------------------------------------------------

  let productSeq = 0;
  async function seedProduct({ price, stock, name = 'Bol en grès' }) {
    const slug = `article-${++productSeq}`;
    await db
      .prepare(
        `INSERT INTO products (public_id, name, slug, description, price_cents, currency, stock, active)
         VALUES (?, ?, ?, '', ?, 'eur', ?, 1)`,
      )
      .bind(`prd_${String(productSeq).padStart(10, '0')}`, name, slug, price, stock)
      .run();
    return db.prepare('SELECT id, name, price_cents FROM products WHERE slug = ?').bind(slug).first();
  }

  /** What the checkout route does before handing off: identity, then the hold. */
  async function beginCheckout(
    product,
    { quantity = 1, ttlSeconds = 1800, consent = null, vatRateBps = null } = {},
  ) {
    const { publicId, accessToken } = await claimOrderIdentity(db);
    const items = [
      {
        productId: product.id,
        variantId: null,
        name: product.name,
        priceCents: product.price_cents,
        quantity,
      },
    ];
    // The last two arguments are the pair that only the reservation can carry:
    // the checkout request sees the shopper, the settlement webhook never does.
    const held = await reserveInventory(
      db,
      publicId,
      items,
      ttlSeconds,
      'stripe',
      undefined,
      undefined,
      consent,
      vatRateBps,
    );
    return { publicId, accessToken, items, held };
  }

  const stockOf = async (id) =>
    (await db.prepare('SELECT stock FROM products WHERE id = ?').bind(id).first()).stock;
  const reservationStatus = async (publicId) =>
    (
      await db
        .prepare('SELECT status FROM checkout_reservations WHERE public_id = ?')
        .bind(publicId)
        .first()
    )?.status ?? null;
  const orderBySession = async (sessionId) =>
    db.prepare('SELECT * FROM orders WHERE provider_session_id = ?').bind(sessionId).first();
  const itemsOf = async (orderId) =>
    (
      await db
        .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
        .bind(orderId)
        .all()
    ).results ?? [];
  const notificationsOf = async (orderId) =>
    (
      await db
        .prepare('SELECT kind, state, attempts, last_error FROM order_notifications WHERE order_id = ? ORDER BY kind')
        .bind(orderId)
        .all()
    ).results ?? [];

  // --- the lifecycle -------------------------------------------------------

  console.log('Settlement lifecycle');

  await check('paiement réussi : la commande porte le panier réservé, pas la session', async () => {
    const product = await seedProduct({ price: 4990, stock: 3 });
    const { publicId } = await beginCheckout(product, { quantity: 2 });
    assert.equal(await stockOf(product.id), 1, 'the hold takes the stock at checkout');

    await deliver(
      sessionEvent(
        'checkout.session.completed',
        paidSession({
          sessionId: 'cs_paid_1',
          reservationId: publicId,
          paymentIntent: 'pi_paid_1',
          amountTotal: 10570,
          shippingCents: 590,
          rate: { id: 'shr_1', display_name: 'Colissimo', metadata: { delivery: 'shipping' } },
        }),
      ),
    );

    const order = await orderBySession('cs_paid_1');
    assert(order, 'the paid session produced an order');
    assert.equal(order.status, 'paid');
    assert.equal(order.public_id, publicId, 'the order keeps the identity claimed at checkout');
    assert.equal(order.payment_method, 'stripe');
    assert.equal(order.provider_payment_id, 'pi_paid_1', 'stored so a refund event can find it');
    assert.equal(order.amount_total_cents, 10570);
    assert.equal(order.shipping_cents, 590);
    assert.equal(order.shipping_label, 'Colissimo');
    assert.equal(order.delivery_method, 'shipping');
    assert.equal(order.currency, 'eur');
    assert.equal(JSON.parse(order.ship_address).city, 'Nantes');

    const items = await itemsOf(order.id);
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 2);
    assert.equal(items[0].price_cents, 4990);

    assert.equal(await reservationStatus(publicId), 'settled');
    assert.equal(await stockOf(product.id), 1, 'settlement consumes the hold, never the shelf twice');
  });

  await check('prix changé depuis la réservation : la commande garde le prix tenu', async () => {
    const product = await seedProduct({ price: 2500, stock: 4 });
    const { publicId } = await beginCheckout(product, { quantity: 1 });
    // The merchant re-prices while the shopper is on the hosted page.
    await db.prepare('UPDATE products SET price_cents = 9900 WHERE id = ?').bind(product.id).run();

    await deliver(
      sessionEvent(
        'checkout.session.completed',
        paidSession({
          sessionId: 'cs_paid_2',
          reservationId: publicId,
          paymentIntent: 'pi_paid_2',
          amountTotal: 2500,
        }),
      ),
    );

    const order = await orderBySession('cs_paid_2');
    const items = await itemsOf(order.id);
    assert.equal(items[0].price_cents, 2500, 'the reservation snapshot is authoritative, not the catalogue');
    assert.equal(order.amount_total_cents, 2500);
  });

  await check('webhook dupliqué : une seule commande, une seule série de lignes', async () => {
    const product = await seedProduct({ price: 1500, stock: 2 });
    const { publicId } = await beginCheckout(product, { quantity: 1 });
    const event = sessionEvent(
      'checkout.session.completed',
      paidSession({
        sessionId: 'cs_dup',
        reservationId: publicId,
        paymentIntent: 'pi_dup',
        amountTotal: 1500,
      }),
    );

    await deliver(event);
    await deliver(event); // Stripe redelivers until it sees a 2xx.

    const rows = await db
      .prepare('SELECT COUNT(*) AS n FROM orders WHERE provider_session_id = ?')
      .bind('cs_dup')
      .first();
    assert.equal(rows.n, 1);
    const order = await orderBySession('cs_dup');
    assert.equal((await itemsOf(order.id)).length, 1);
    assert.equal(await stockOf(product.id), 1, 'a redelivery must not take a second unit');
  });

  await check('session expirée : le stock revient, aucune commande', async () => {
    const product = await seedProduct({ price: 3000, stock: 2 });
    const { publicId } = await beginCheckout(product, { quantity: 2 });
    assert.equal(await stockOf(product.id), 0);

    await deliver(
      sessionEvent('checkout.session.expired', {
        id: 'cs_expired',
        metadata: { reservation_id: publicId },
      }),
    );

    assert.equal(await stockOf(product.id), 2, 'an expired hosted session puts the units back');
    assert.equal(await reservationStatus(publicId), 'expired');
    assert.equal(await orderBySession('cs_expired'), null);
  });

  await check('expiration désordonnée : arrivée après le règlement, elle ne rend rien', async () => {
    const product = await seedProduct({ price: 3000, stock: 2 });
    const { publicId } = await beginCheckout(product, { quantity: 1 });
    await deliver(
      sessionEvent(
        'checkout.session.completed',
        paidSession({
          sessionId: 'cs_ooo',
          reservationId: publicId,
          paymentIntent: 'pi_ooo',
          amountTotal: 3000,
        }),
      ),
    );
    assert.equal(await stockOf(product.id), 1);

    // Stripe's expiry for the same session, delivered late.
    await deliver(
      sessionEvent('checkout.session.expired', {
        id: 'cs_ooo',
        metadata: { reservation_id: publicId },
      }),
    );

    assert.equal(await stockOf(product.id), 1, 'a settled reservation is not releasable');
    assert.equal(await reservationStatus(publicId), 'settled');
    assert((await orderBySession('cs_ooo')) !== null, 'the order survives its own late expiry');
  });

  await check('paiement asynchrone : en attente, puis réussi', async () => {
    const product = await seedProduct({ price: 4500, stock: 1 });
    const { publicId } = await beginCheckout(product, { quantity: 1 });

    // A delayed method completes the session while still unpaid.
    await deliver(
      sessionEvent(
        'checkout.session.completed',
        paidSession({
          sessionId: 'cs_async_ok',
          reservationId: publicId,
          paymentIntent: 'pi_async_ok',
          amountTotal: 4500,
          paymentStatus: 'unpaid',
        }),
      ),
    );
    assert.equal(await orderBySession('cs_async_ok'), null, 'unpaid is never an order');
    assert.equal(
      await reservationStatus(publicId),
      'payment_pending',
      'the hold is protected from ordinary expiry reclamation',
    );
    assert.equal(await stockOf(product.id), 0, 'the units stay held while the funds clear');

    await deliver(
      sessionEvent(
        'checkout.session.async_payment_succeeded',
        paidSession({
          sessionId: 'cs_async_ok',
          reservationId: publicId,
          paymentIntent: 'pi_async_ok',
          amountTotal: 4500,
        }),
      ),
    );
    const order = await orderBySession('cs_async_ok');
    assert(order, 'the cleared payment settles');
    assert.equal((await itemsOf(order.id)).length, 1);
    assert.equal(await reservationStatus(publicId), 'settled');
  });

  await check('paiement asynchrone échoué : le stock revient, aucune commande', async () => {
    const product = await seedProduct({ price: 4500, stock: 1 });
    const { publicId } = await beginCheckout(product, { quantity: 1 });
    await deliver(
      sessionEvent(
        'checkout.session.completed',
        paidSession({
          sessionId: 'cs_async_ko',
          reservationId: publicId,
          paymentIntent: 'pi_async_ko',
          amountTotal: 4500,
          paymentStatus: 'unpaid',
        }),
      ),
    );
    assert.equal(await reservationStatus(publicId), 'payment_pending');

    await deliver(
      sessionEvent('checkout.session.async_payment_failed', {
        id: 'cs_async_ko',
        metadata: { reservation_id: publicId },
      }),
    );

    assert.equal(await stockOf(product.id), 1, 'a failed debit puts the unit back on the shelf');
    assert.equal(await reservationStatus(publicId), 'failed');
    assert.equal(await orderBySession('cs_async_ko'), null);
  });

  await check('signature invalide : rien n’est écrit', async () => {
    const product = await seedProduct({ price: 1000, stock: 1 });
    const { publicId } = await beginCheckout(product, { quantity: 1 });
    const event = sessionEvent(
      'checkout.session.completed',
      paidSession({
        sessionId: 'cs_forged',
        reservationId: publicId,
        paymentIntent: 'pi_forged',
        amountTotal: 1000,
      }),
    );

    await assert.rejects(
      () => deliver(event, { secret: 'whsec_wrong' }),
      /signature/i,
      'a payload signed with another secret is refused',
    );
    assert.equal(await orderBySession('cs_forged'), null);
    assert.equal(await reservationStatus(publicId), 'active', 'the hold is untouched');
  });

  await check('achat concurrent de la dernière unité : un seul gagne', async () => {
    const product = await seedProduct({ price: 8000, stock: 1 });
    const first = await beginCheckout(product, { quantity: 1 });
    const second = await beginCheckout(product, { quantity: 1 });

    assert.equal(first.held, true);
    assert.equal(second.held, false, 'the second hold finds nothing left to claim');
    assert.equal(await stockOf(product.id), 0);

    await deliver(
      sessionEvent(
        'checkout.session.completed',
        paidSession({
          sessionId: 'cs_last_unit',
          reservationId: first.publicId,
          paymentIntent: 'pi_last_unit',
          amountTotal: 8000,
        }),
      ),
    );
    assert((await orderBySession('cs_last_unit')) !== null);
    assert.equal(await stockOf(product.id), 0);
  });

  await check('stock changé sous une réservation expirée : la commande porte son manque', async () => {
    const product = await seedProduct({ price: 2000, stock: 5 });
    const { publicId } = await beginCheckout(product, { quantity: 3 });
    // The hosted session expired, the units went back, and the merchant sold
    // them elsewhere before the (late) paid webhook arrived.
    await db
      .prepare("UPDATE checkout_reservations SET status = 'expired' WHERE public_id = ?")
      .bind(publicId)
      .run();
    await db.prepare('UPDATE products SET stock = 1 WHERE id = ?').bind(product.id).run();

    await deliver(
      sessionEvent(
        'checkout.session.completed',
        paidSession({
          sessionId: 'cs_late',
          reservationId: publicId,
          paymentIntent: 'pi_late',
          amountTotal: 6000,
        }),
      ),
    );

    const order = await orderBySession('cs_late');
    assert(order, 'a paid customer gets an order even when the shelf moved');
    const exceptions =
      (
        await db
          .prepare('SELECT * FROM order_inventory_exceptions WHERE order_id = ?')
          .bind(order.id)
          .all()
      ).results ?? [];
    assert.equal(exceptions.length, 1, 'the shortfall is recorded, not swallowed');
    assert.equal(exceptions[0].requested_qty, 3);
    assert.equal(exceptions[0].consumed_qty, 1);
    assert.equal(exceptions[0].shortfall_qty, 2);
    assert.equal(await stockOf(product.id), 0, 'stock floors at zero rather than going negative');
  });

  await check('TVA et acceptation des CGV : portées par la réservation', async () => {
    const product = await seedProduct({ price: 12000, stock: 1 });
    const consent = { version: '2026-01', acceptedAt: '2026-09-01 09:15:00' };
    const { publicId } = await beginCheckout(product, { consent, vatRateBps: 2000 });

    await deliver(
      sessionEvent(
        'checkout.session.completed',
        paidSession({
          sessionId: 'cs_tva',
          reservationId: publicId,
          paymentIntent: 'pi_tva',
          amountTotal: 12000,
        }),
      ),
    );

    const order = await orderBySession('cs_tva');
    assert.equal(order.terms_version, '2026-01', 'the acceptance survives the handoff');
    assert.equal(order.terms_accepted_at, '2026-09-01 09:15:00');
    assert.equal(order.vat_rate_bps, 2000);
    // Prices are TTC (ADR 0010), so the tax is inside the total: 120,00 € at
    // 20 % contains 20,00 €, taken once on the total and not per line.
    assert.equal(order.vat_amount_cents, vatIncludedCents(12000, 2000));
    assert.equal(order.vat_amount_cents, 2000);
    assert.equal(order.tax_cents, 0, 'tax_cents keeps its own meaning: tax added on top');
  });

  // --- refunds -------------------------------------------------------------

  console.log('Refunds');

  await check('remboursement partiel puis total : le cumul du fournisseur fait foi', async () => {
    const product = await seedProduct({ price: 5000, stock: 2 });
    const { publicId } = await beginCheckout(product, { quantity: 1 });
    await deliver(
      sessionEvent(
        'checkout.session.completed',
        paidSession({
          sessionId: 'cs_refund',
          reservationId: publicId,
          paymentIntent: 'pi_refund',
          amountTotal: 5000,
        }),
      ),
    );
    const order = await orderBySession('cs_refund');

    const partial = refundEvent({
      paymentIntent: 'pi_refund',
      chargeId: 'ch_refund',
      cumulativeCents: 1500,
    });
    await deliver(partial);
    let refreshed = await orderBySession('cs_refund');
    assert.equal(refreshed.provider_refunded_cents, 1500);
    assert.equal(refreshed.refunded_cents, 1500);

    // A second partial: Stripe reports the CUMULATIVE total, not the delta.
    await deliver(
      refundEvent({ paymentIntent: 'pi_refund', chargeId: 'ch_refund', cumulativeCents: 5000 }),
    );
    refreshed = await orderBySession('cs_refund');
    assert.equal(refreshed.provider_refunded_cents, 5000);
    assert.equal(refreshed.refunded_cents, 5000, 'fully refunded');

    // The first event redelivered, out of order and after the larger one.
    await deliver(partial);
    refreshed = await orderBySession('cs_refund');
    assert.equal(
      refreshed.provider_refunded_cents,
      5000,
      'an absolute total cannot be walked backwards by a replay',
    );

    const refunds =
      (await db.prepare('SELECT * FROM refunds WHERE order_id = ? ORDER BY id').bind(order.id).all())
        .results ?? [];
    assert.equal(refunds.length, 2, 'two advances, two refund rows — the replay adds none');
    assert.deepEqual(
      refunds.map((r) => r.amount_cents),
      [1500, 3500],
      'each row is its own delta, not the running total',
    );

    const events =
      (await db.prepare('SELECT provider_event_id, status FROM refund_sync_events ORDER BY created_at, rowid').all())
        .results ?? [];
    assert.equal(events.length, 2, 'the replayed event reuses its stored row');
    assert(events.every((e) => e.status === 'processed'));
  });

  await check('remboursement sans commande : gardé pour réconciliation, jamais perdu', async () => {
    await deliver(
      refundEvent({
        paymentIntent: 'pi_unknown',
        chargeId: 'ch_unknown',
        cumulativeCents: 900,
      }),
    );
    const row = await db
      .prepare('SELECT status FROM refund_sync_events WHERE provider_payment_id = ?')
      .bind('pi_unknown')
      .first();
    assert.equal(row.status, 'unmatched', 'a valid event we cannot correlate is queued, not dropped');
  });

  // --- e-mails -------------------------------------------------------------

  console.log('Notifications');

  await check('e-mail non configuré : les lignes sont écartées, pas en échec', async () => {
    const product = await seedProduct({ price: 1200, stock: 1 });
    const { publicId } = await beginCheckout(product, { quantity: 1 });
    await deliver(
      sessionEvent(
        'checkout.session.completed',
        paidSession({
          sessionId: 'cs_mail_off',
          reservationId: publicId,
          paymentIntent: 'pi_mail_off',
          amountTotal: 1200,
        }),
      ),
    );
    const order = await orderBySession('cs_mail_off');
    const rows = await notificationsOf(order.id);
    assert.deepEqual(
      rows.map((r) => r.kind),
      ['customer-receipt', 'owner-notification'],
      'the outbox rows are born in the settlement batch',
    );
    assert(rows.every((r) => r.state === 'skipped'), 'no provider is not a failure');
  });

  await check('Resend indisponible : la commande tient, l’e-mail se rattrape', async () => {
    await setSecret(db, 'resend_api_key', 're_double');
    await setSetting(db, 'email_notify_to', 'boutique@exemple.fr');
    const guardedFetch = globalThis.fetch;
    let attempted = 0;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.startsWith('https://api.resend.com')) {
        attempted++;
        return new Response('service unavailable', { status: 503 });
      }
      return guardedFetch(input, init);
    };

    let order;
    try {
      const product = await seedProduct({ price: 3300, stock: 1 });
      const { publicId } = await beginCheckout(product, { quantity: 1 });
      await deliver(
        sessionEvent(
          'checkout.session.completed',
          paidSession({
            sessionId: 'cs_mail_down',
            reservationId: publicId,
            paymentIntent: 'pi_mail_down',
            amountTotal: 3300,
          }),
        ),
      );
      order = await orderBySession('cs_mail_down');
      assert(order, 'a mail outage never costs the order');
      assert(attempted > 0, 'the provider was actually called');
      const rows = await notificationsOf(order.id);
      assert(
        rows.every((r) => r.state === 'pending' && r.attempts === 1),
        `a failed send stays retryable: ${JSON.stringify(rows)}`,
      );
      assert(rows.every((r) => /503/.test(r.last_error ?? '')));
    } finally {
      globalThis.fetch = guardedFetch;
    }

    // Provider back: the same rows finish, without a second webhook.
    const sent = [];
    const recoveredFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.startsWith('https://api.resend.com')) {
        sent.push(JSON.parse(init.body));
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return recoveredFetch(input, init);
    };
    try {
      await deliverOrderNotifications(db, order.id, ORIGIN, await getStoreSettings(db));
      const rows = await notificationsOf(order.id);
      assert(rows.every((r) => r.state === 'sent'), `recovered: ${JSON.stringify(rows)}`);
      assert.equal(sent.length, 2, 'the receipt and the owner notice, once each');
    } finally {
      globalThis.fetch = recoveredFetch;
      await setSecret(db, 'resend_api_key', null);
    }
  });
} finally {
  globalThis.fetch = REAL_FETCH;
  await mf.dispose();
}

if (failures > 0) {
  console.error(`\n${failures} settlement check(s) failed.`);
  process.exit(1);
}
console.log('\nSettlement lifecycle: all checks passed.');
