/**
 * Five buyers, one unit (plan §8.6 "cinq checkouts concurrents sans
 * survente", campagne étape 6).
 *
 * test/integration/reservations.mjs already proves the stock hold is one
 * guarded UPDATE, on a local D1. What only a deployed shop can show is that
 * it stays one on the platform — five requests that reach five isolates at
 * once, against the real D1 — and the property is the same: exactly one
 * checkout session opens, the other four are told it sold out.
 *
 * The product is NAMED, never chosen: this consumes the unit. Its stock has
 * to be exactly 1, set in the admin beforehand, and the script checks that
 * before it fires — an order of `quantity: 1000000` is refused with the
 * number actually in stock, and reserves nothing.
 *
 * Run: BASE_URL=https://… npm run test:last-unit:remote -- --product <slug> [--method stripe]
 *
 * Afterwards the unit is HELD, not sold: nobody pays the session. It comes
 * back when the hold expires (35 minutes for Stripe, 24 hours for the demo
 * rail) — so a second run waits for that, or names another product. Setting
 * the stock back to 1 by hand before then makes it 2 once the hold expires.
 */
import { parseArgs } from 'node:util';
import { fetchAs, isAccessChallenge, remoteTarget } from './target.mjs';

const BUYERS = 5;

const { values: options } = parseArgs({
  options: { product: { type: 'string' }, method: { type: 'string' } },
});

const fail = (message, code) => {
  console.error(`dernière unité : ${message}`);
  process.exit(code);
};

let target;
try {
  target = remoteTarget();
} catch (error) {
  fail(error.message, 2);
}
if (!options.product) fail('--product <slug> est obligatoire : le produit dont le stock a été mis à 1.', 2);

/**
 * One JSON checkout of `quantity` units. A fictitious buyer: the in-app rails
 * (demo, Lightning, OpenNode) need an address to quote shipping, the hosted
 * one only a country.
 */
function checkout(quantity) {
  return fetchAs(target, '/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ slug: options.product, quantity }],
      ...(options.method ? { method: options.method } : {}),
      accept_terms: true,
      ship_country: 'FR',
      ship_to: {
        email: 'derniere-unite@example.invalid',
        name: 'Certification',
        line1: '1 rue de la Recette',
        city: 'Paris',
        postal: '75001',
        country: 'FR',
      },
    }),
  });
}

/** The stock as the checkout sees it, without holding any of it. */
async function stockOf() {
  const response = await checkout(1_000_000);
  const body = await response.json().catch(() => ({}));
  if (response.status === 409 && Number.isInteger(body.available)) return body.available;
  fail(`la sonde de stock a reçu ${response.status} ${JSON.stringify(body)}`, 4);
}

const detail = await fetchAs(target, `/api/products/${encodeURIComponent(options.product)}`);
if (isAccessChallenge(detail)) fail('Cloudflare Access répond à la place du Worker : posez CF_ACCESS_CLIENT_ID et CF_ACCESS_CLIENT_SECRET.', 2);
if (detail.status === 404) fail(`aucun produit actif « ${options.product} ».`, 3);
const product = await detail.json();
if (product.variants?.length > 0) fail(`« ${options.product} » a des variantes : nommez un produit simple.`, 3);

const before = await stockOf();
if (before === 0) {
  fail(`« ${options.product} » est à 0 : si une réservation d'un run précédent le tient, attendez qu'elle expire, ou nommez un autre produit.`, 4);
}
if (before !== 1) fail(`le stock de « ${options.product} » est ${before} : mettez-le à 1 dans l'admin, puis relancez.`, 4);

console.log(`Dernière unité — ${target.origin} : ${BUYERS} checkouts simultanés sur « ${product.name} » (stock 1).`);

// Built first, sent together: the five requests leave in the same tick.
const answers = await Promise.all(
  Array.from({ length: BUYERS }, async () => {
    const response = await checkout(1);
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }),
);

const opened = answers.filter((answer) => answer.status === 200 && answer.body.checkout_url);
const soldOut = answers.filter((answer) => answer.status === 409);
const other = answers.filter((answer) => !opened.includes(answer) && !soldOut.includes(answer));
const after = await stockOf();

for (const answer of answers) {
  // The checkout URL is a capability (a payment session); its host is enough.
  const shown = answer.body.checkout_url ? `session ouverte sur ${new URL(answer.body.checkout_url).host}` : answer.body.error ?? '';
  console.log(`  ${answer.status}  ${shown}`);
}
console.log(`\nstock après : ${after}`);

const problems = [];
if (opened.length !== 1) problems.push(`${opened.length} session(s) de paiement ouvertes au lieu d'une`);
if (soldOut.length !== BUYERS - 1) problems.push(`${soldOut.length} refus « épuisé » au lieu de ${BUYERS - 1}`);
if (other.length > 0) problems.push(`réponses inattendues : ${other.map((answer) => answer.status).join(', ')}`);
if (after !== 0) problems.push(`le stock vaut ${after} après une réservation sur 1`);

if (problems.length > 0) {
  console.log(`\n✗ ${problems.join(' ; ')}`);
  process.exit(1);
}
console.log('\n✓ une seule session, quatre refus, aucune survente.');
console.log('  L\'unité reste réservée jusqu\'à l\'expiration de la session (35 min pour Stripe).');
