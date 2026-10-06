/**
 * The load scenario of the certification (plan §8.6, campagne étape 6):
 * twenty virtual shoppers for fifteen minutes, against a deployed shop.
 *
 * What it answers is the line of §8.6 a container cannot: "no Worker error
 * under load". Each shopper walks the storefront the way a person does —
 * home, a category, a product, now and then a search, an add to the cart, the
 * cart — with a human pause between steps. Twenty of them make a few requests
 * a second, which is the traffic a small shop sees on a good day, not a
 * stress test; what is under test is that the Worker, D1 and the Free plan's
 * 10 ms of CPU hold that for a quarter of an hour without one 5xx.
 *
 * The rate limiters, NOT switched off (plan, étape 6). Every shopper here
 * shares one IP, and the limiters key on it, so twenty people searching at
 * once from one address would be judged as one person searching twenty times
 * — a 429 the limiter is right to send. Search is therefore paced across the
 * whole run, at half the limiter's allowance (SEARCH 60/60 s); a 429 is still
 * counted, reported apart, and fails nothing. Checkout is left out entirely:
 * each one holds stock and opens a payment session, which is a scenario of
 * its own (last-unit.mjs), not background traffic.
 *
 * Run: BASE_URL=https://… npm run test:load:remote -- [--users 20] [--minutes 15] [--json report.json]
 * (plus CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET behind a private preview)
 *
 * Exit 0 with no 5xx and no failed request, 1 otherwise, 2 on a bad
 * configuration. The Worker's own view — CPU, D1 rows read and written —
 * is `shopctl monitor --env <env> --hours 1` right after.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchAs, isAccessChallenge, remoteTarget } from './target.mjs';

const { values: options } = parseArgs({
  options: {
    users: { type: 'string', default: '20' },
    minutes: { type: 'string', default: '15' },
    json: { type: 'string' },
  },
});
const USERS = Number(options.users);
const MINUTES = Number(options.minutes);

let target;
try {
  target = remoteTarget();
  if (!(Number.isInteger(USERS) && USERS > 0) || !(MINUTES > 0)) {
    throw new Error('--users est un entier positif, --minutes un nombre positif.');
  }
} catch (error) {
  console.error(`charge : ${error.message}`);
  process.exit(2);
}

/** A shopper's pause between two pages: one to four seconds. */
const think = () => new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 3000));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/* -------------------------------------------------------------- catalogue */

async function discover() {
  const home = await fetchAs(target, '/');
  if (isAccessChallenge(home)) throw new Error('Cloudflare Access répond à la place du Worker : posez CF_ACCESS_CLIENT_ID et CF_ACCESS_CLIENT_SECRET.');
  const products = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const response = await fetchAs(target, `/api/products?limit=100&offset=${offset}`);
    if (!response.ok) throw new Error(`/api/products a répondu ${response.status}`);
    const page = await response.json();
    products.push(...page.products);
    if (page.products.length < 100) break;
  }
  if (products.length === 0) throw new Error('le catalogue est vide : il n\'y a rien à parcourir.');
  const sitemap = await (await fetchAs(target, '/sitemap.xml')).text();
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => new URL(loc).pathname);
  const words = [...new Set(products.flatMap((product) => product.name.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4)))];
  return {
    products,
    // An add needs no variant choice to succeed; a variant product's add
    // without one is a redirect, which would measure nothing.
    addable: products.filter((product) => product.in_stock && !product.variant_label),
    categories: paths.filter((path) => path.startsWith('/categories/')),
    words: words.length > 0 ? words : ['a'],
  };
}

/* ------------------------------------------------------------ measurement */

const stats = new Map();
const started = Date.now();
let searchesThisMinute = 0;
let minute = 0;

function record(step, response, elapsed, failure = null) {
  let entry = stats.get(step);
  if (!entry) stats.set(step, (entry = { latencies: [], statuses: {}, failures: 0 }));
  if (failure) {
    entry.failures++;
    return;
  }
  entry.latencies.push(elapsed);
  entry.statuses[response.status] = (entry.statuses[response.status] ?? 0) + 1;
}

/** Half the SEARCH limiter's allowance, shared by every shopper. */
function searchAllowed() {
  const now = Math.floor((Date.now() - started) / 60_000);
  if (now !== minute) {
    minute = now;
    searchesThisMinute = 0;
  }
  if (searchesThisMinute >= 30) return false;
  searchesThisMinute++;
  return true;
}

async function step(name, path, init = {}) {
  const begin = performance.now();
  try {
    const response = await fetchAs(target, path, init);
    // Read the body: a response is not served until its last byte is.
    await response.arrayBuffer();
    record(name, response, performance.now() - begin);
    return response;
  } catch (error) {
    record(name, null, performance.now() - begin, error);
    return null;
  }
}

/* --------------------------------------------------------------- shoppers */

async function shopper(catalogue, deadline) {
  const jar = new Map();
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const keep = (response) => {
    for (const line of response?.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      jar.set(pair.slice(0, at).trim(), pair.slice(at + 1));
    }
  };

  while (Date.now() < deadline) {
    keep(await step('accueil', '/', { headers: { cookie: cookie() } }));
    await think();
    if (catalogue.categories.length > 0 && Math.random() < 0.6) {
      keep(await step('catégorie', pick(catalogue.categories), { headers: { cookie: cookie() } }));
      await think();
    }
    const product = pick(catalogue.products);
    keep(await step('fiche produit', `/products/${encodeURIComponent(product.slug)}`, { headers: { cookie: cookie() } }));
    await think();
    if (Math.random() < 0.3 && searchAllowed()) {
      keep(await step('recherche', `/search?q=${encodeURIComponent(pick(catalogue.words))}`, { headers: { cookie: cookie() } }));
      await think();
    }
    if (Math.random() < 0.15) {
      await step('catalogue JSON', '/api/products?limit=24');
      await think();
    }
    if (catalogue.addable.length > 0 && Math.random() < 0.25) {
      const item = pick(catalogue.addable);
      keep(
        await step('ajout au panier', '/api/cart', {
          method: 'POST',
          headers: {
            origin: target.origin,
            'content-type': 'application/x-www-form-urlencoded',
            'x-partial': '1',
            cookie: cookie(),
          },
          body: new URLSearchParams({ _action: 'add', product_id: item.id }).toString(),
        }),
      );
      await think();
      keep(await step('panier', '/cart', { headers: { cookie: cookie() } }));
      await think();
    }
  }
}

/* ----------------------------------------------------------------- report */

const quantile = (sorted, q) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);

function summary() {
  const rows = [];
  let total = 0;
  let errors = 0;
  let limited = 0;
  for (const [name, entry] of stats) {
    const sorted = [...entry.latencies].sort((a, b) => a - b);
    const serverErrors = Object.entries(entry.statuses)
      .filter(([status]) => Number(status) >= 500)
      .reduce((sum, [, count]) => sum + count, 0);
    const throttled = entry.statuses[429] ?? 0;
    total += sorted.length + entry.failures;
    errors += serverErrors + entry.failures;
    limited += throttled;
    rows.push({
      step: name,
      requests: sorted.length + entry.failures,
      p50: Math.round(quantile(sorted, 0.5)),
      p95: Math.round(quantile(sorted, 0.95)),
      p99: Math.round(quantile(sorted, 0.99)),
      statuses: entry.statuses,
      failed: entry.failures,
    });
  }
  return { total, errors, limited, rows };
}

/* ------------------------------------------------------------------- main */

let catalogue;
try {
  catalogue = await discover();
} catch (error) {
  console.error(`charge : ${error.message}`);
  process.exit(2);
}

const deadline = started + MINUTES * 60_000;
console.log(
  `Charge — ${target.origin} : ${USERS} acheteur(s) pendant ${MINUTES} min, ` +
    `${catalogue.products.length} produit(s), ${catalogue.categories.length} catégorie(s).`,
);

const ticker = setInterval(() => {
  const { total, errors, limited } = summary();
  const elapsed = (Date.now() - started) / 1000;
  console.log(`  ${Math.round(elapsed / 60)} min — ${total} requêtes (${(total / elapsed).toFixed(1)}/s), ${errors} erreur(s), ${limited} limitée(s)`);
}, 60_000);

// Staggered over the first minute (a tenth of a short run), the way a shop
// fills up, rather than twenty identical journeys in lockstep.
const ramp = Math.min(60_000, MINUTES * 6_000);
await Promise.all(
  Array.from({ length: USERS }, (_, index) =>
    new Promise((resolve) => setTimeout(resolve, (index * ramp) / USERS)).then(() => shopper(catalogue, deadline)),
  ),
);
clearInterval(ticker);

const report = { origin: target.origin, users: USERS, minutes: MINUTES, finishedAt: new Date().toISOString(), ...summary() };
console.log('\nétape              requêtes   p50    p95    p99  (ms)   statuts');
for (const row of report.rows) {
  const statuses = Object.entries(row.statuses).map(([status, count]) => `${status}×${count}`).join(' ');
  console.log(
    `${row.step.padEnd(18)} ${String(row.requests).padStart(8)} ${String(row.p50).padStart(5)} ${String(row.p95).padStart(6)} ${String(row.p99).padStart(6)}        ${statuses}${row.failed ? ` échecs×${row.failed}` : ''}`,
  );
}
console.log(
  `\n${report.total} requêtes, ${report.errors} erreur(s) (5xx ou requête perdue), ${report.limited} réponse(s) 429 du limiteur.` +
    `\nConsommation côté Cloudflare : shopctl monitor --env <environnement> --hours 1`,
);
if (options.json) writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
process.exit(report.errors === 0 ? 0 : 1);
