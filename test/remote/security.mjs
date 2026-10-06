/**
 * The security gate, against a deployed shop (plan §8.4, certification étape 0).
 *
 * `test/integration/security.mjs` proves the admin door and the hardening on
 * the built Worker, in process, with Miniflare. What it cannot prove is that
 * the same holds on the platform — behind Cloudflare's edge, its URL
 * normalisation, its asset server, a custom domain. This is the subset of that
 * gate that needs nothing but HTTP, re-run against a real origin:
 *
 *   - the admin surface, derived from the route files, refused anonymously;
 *   - the setup wizard closed, a forged Access assertion ignored;
 *   - cross-origin and origin-less form posts refused;
 *   - path traversal answered with a refusal that leaks nothing;
 *   - the hardening headers on every class of response, static assets included;
 *   - a capability URL that does not exist answering 404 and keeping no-referrer;
 *   - an unhandled error answering a hardened, uncacheable 500.
 *
 * What stays local, and why: the log assertions (they read the Worker's stdout),
 * brute force (tripping the limiter on a real shop locks its owner out for a
 * minute), uploads and sessions (they need an admin session, which this gate
 * must never hold).
 *
 * Run: BASE_URL=https://… npm run test:security:remote
 * (plus CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET behind a private preview)
 *
 * It sends ONE request that makes the Worker throw on purpose (the 500 check),
 * so a run shows up as one error in `shopctl monitor` — never enough to judge.
 */
import { adminRoutes } from '../helpers/admin-routes.mjs';
import { generateAccessToken } from '../../src/features/ids/token.ts';
import { fetchAs, isAccessChallenge, remoteTarget } from './target.mjs';

const FORM = 'application/x-www-form-urlencoded';
const LEAK = /root:|"name": "minshop"|CREATE TABLE|sqlite|D1_ERROR|\bat .+\.(m?js|ts):\d+/i;

let target;
try {
  target = remoteTarget();
} catch (error) {
  console.error(`remote-security: ${error.message}`);
  process.exit(2);
}

const failures = [];
let passed = 0;
const section = (title) => console.log(`\n▸ ${title}`);
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, reason: error.message });
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};
const get = (path, init) => fetchAs(target, path, init);
const locationPath = (response) => {
  const location = response.headers.get('location');
  return location ? new URL(location, target.origin).pathname : null;
};

console.log(`Porte de sécurité distante — ${target.origin}${target.behindAccess ? ' (jeton de service Access)' : ''}`);

/* ------------------------------------------------------------------ reach */

const home = await get('/');
if (isAccessChallenge(home)) {
  console.error('\nCloudflare Access répond à la place du Worker : posez CF_ACCESS_CLIENT_ID et CF_ACCESS_CLIENT_SECRET.');
  process.exit(2);
}

// The Worker's own gate decides which refusals are correct. A password sends
// the anonymous visitor to the login page; Access mode answers 403.
const probe = await get('/admin');
const mode = probe.status === 403 ? 'access' : probe.status === 303 && locationPath(probe) === '/admin/login' ? 'password' : null;

/* ------------------------------------------------------- the admin surface */

section('La porte d\'administration');

await check(`l'admin refuse l'anonyme (mode ${mode ?? 'inconnu'})`, () => {
  expect(mode !== null, `GET /admin a répondu ${probe.status} ${probe.headers.get('location') ?? ''} : ni la page de connexion, ni un refus`);
});

const routes = adminRoutes();
await check(`${routes.length} routes d'administration dérivées des fichiers, refusées sur chaque verbe`, async () => {
  expect(routes.length >= 30, `seulement ${routes.length} routes dérivées : le chemin src/pages a-t-il changé ?`);
  const wrong = [];
  for (const { path, verbs } of routes) {
    for (const verb of verbs) {
      const init = verb === 'GET' ? {} : { method: verb, headers: { origin: target.origin, 'content-type': FORM }, body: '' };
      const response = await get(path, init);
      const status = response.status;
      const refused =
        status === 403 ||
        (path.startsWith('/api/') && status === 401) ||
        (path === '/admin/login' && status === 200) ||
        (!path.startsWith('/api/') && status === 303 && locationPath(response) === '/admin/login');
      if (!refused) wrong.push(`${verb} ${path} → ${status}`);
    }
  }
  expect(wrong.length === 0, wrong.join(', '));
});

await check('le magicien d\'installation est fermé', async () => {
  const response = await get('/admin/setup');
  expect(response.status !== 200, '/admin/setup répond 200 : la boutique est en mode amorçage, quiconque peut poser le mot de passe');
});

await check('une assertion Access forgée n\'ouvre rien', async () => {
  // Built rather than written out: the shape of a JWT, signed by nobody.
  const part = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
  const forged = `${part({ alg: 'RS256' })}.${part({ email: 'mallory@example.fr' })}.${part('signature')}`;
  const response = await get('/admin', { headers: { 'cf-access-jwt-assertion': forged } });
  expect(response.status === 403 || (response.status === 303 && locationPath(response) === '/admin/login'), `GET /admin avec un jeton forgé → ${response.status}`);
});

await check('une API d\'administration ne dit rien de ce qu\'elle protège', async () => {
  const response = await get('/api/admin/orders/ord_0000000000', {
    method: 'POST',
    headers: { origin: target.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'shipped' }),
  });
  expect(response.status === 401 || response.status === 403, `statut ${response.status}`);
  const body = await response.text();
  expect(!/ord_|stack/i.test(body) && !LEAK.test(body), 'le corps du refus parle de la commande ou de la pile');
});

/* ---------------------------------------------------------- form origin */

section('L\'origine des formulaires');

await check('un POST d\'une autre origine, ou sans origine, est refusé', async () => {
  const wrong = [];
  for (const path of ['/admin/login', '/account/login', '/api/cart', '/cart']) {
    for (const headers of [{ origin: 'https://evil.example', 'content-type': FORM }, { 'content-type': FORM }]) {
      const response = await get(path, { method: 'POST', headers, body: 'password=x' });
      if (response.status !== 403) wrong.push(`${path} ${headers.origin ? 'evil.example' : 'sans Origin'} → ${response.status}`);
    }
  }
  expect(wrong.length === 0, wrong.join(', '));
});

await check('un POST de même origine passe la garde d\'origine', async () => {
  const response = await get('/admin/login', { method: 'POST', headers: { origin: target.origin, 'content-type': FORM }, body: 'password=wrong-on-purpose' });
  expect(mode === 'access' || response.status !== 403, `la garde refuse aussi la boutique elle-même (${response.status})`);
  expect(response.status < 500, `statut ${response.status}`);
});

/* --------------------------------------------------------- path traversal */

section('Traversée de chemin');

await check('huit formes de traversée refusées sans rien laisser voir', async () => {
  const wrong = [];
  for (const path of [
    '/images/../../etc/passwd',
    '/images/..%2f..%2fetc%2fpasswd',
    '/images/media/..%2f..%2f..%2fseed.sql',
    '/images/%2e%2e%2f%2e%2e%2fpackage.json',
    '/images/....//....//package.json',
    '/images/media/%00../../package.json',
    '/pages/../admin/settings',
    '/pages/..%2fadmin%2fsettings',
  ]) {
    const response = await get(path);
    const body = await response.text();
    if (![301, 302, 303, 400, 403, 404].includes(response.status)) wrong.push(`${path} → ${response.status}`);
    else if (response.status < 400 && new URL(response.headers.get('location') ?? '/', target.origin).origin !== target.origin) wrong.push(`${path} redirige hors de l'origine`);
    else if (LEAK.test(body)) wrong.push(`${path} laisse fuiter un contenu`);
  }
  expect(wrong.length === 0, wrong.join(', '));
});

/* ---------------------------------------------------------------- headers */

section('En-têtes de durcissement');

const hardened = (response, label, { cache = true } = {}) => {
  const missing = [];
  if (response.headers.get('x-content-type-options') !== 'nosniff') missing.push('nosniff');
  if (response.headers.get('x-frame-options') !== 'DENY') missing.push('x-frame-options');
  if (!/max-age=\d{7,}/.test(response.headers.get('strict-transport-security') ?? '')) missing.push('hsts');
  if (!/object-src 'none'.*base-uri 'self'.*frame-ancestors 'none'/.test(response.headers.get('content-security-policy') ?? '')) missing.push('csp');
  if (!response.headers.get('referrer-policy')) missing.push('referrer-policy');
  if (cache && !response.headers.get('cache-control')) missing.push('cache-control');
  return missing.length > 0 ? `${label} : ${missing.join(', ')}` : null;
};

await check('chaque classe de réponse du Worker porte le durcissement complet', async () => {
  const wrong = [];
  for (const [label, path] of [
    ['une page publique', '/'],
    ['une 404', '/not-a-route'],
    ['une redirection', '/admin'],
    ['un 401 d\'API admin', '/api/admin/products'],
    ['une API publique', '/api/products?limit=1'],
    ['le point de santé', '/api/health'],
    ['robots.txt', '/robots.txt'],
    ['le plan du site', '/sitemap.xml'],
  ]) {
    const problem = hardened(await get(path), label);
    if (problem) wrong.push(problem);
  }
  expect(wrong.length === 0, wrong.join(' ; '));
});

await check('les actifs statiques, servis avant le Worker, aussi', async () => {
  const problem = hardened(await get('/favicon.svg'), '/favicon.svg', { cache: false });
  expect(problem === null, problem);
});

/* ------------------------------------------------------- capability URLs */

section('URL à capacité');

// A well-formed token nobody was issued. The order page answers it the way it
// answers a buyer who lands before the webhook — a page that waits — so the
// property is not the status but that the URL never leaves in a referrer and
// never sits in a cache; the download beneath it is a plain 404.
await check('un jeton de commande inconnu n\'ouvre rien et ne fuit ni en référent ni en cache', async () => {
  const token = generateAccessToken();
  const order = await get(`/order/${token}`);
  expect([200, 404].includes(order.status), `/order/<jeton> → ${order.status}`);
  expect(order.headers.get('referrer-policy') === 'no-referrer', '/order/<jeton> sans no-referrer');
  expect(order.headers.get('cache-control') === 'private, no-store', `/order/<jeton> cache-control ${order.headers.get('cache-control')}`);
  const download = await get(`/order/${token}/download/itm_0000000000`);
  expect(download.status === 404, `/order/<jeton>/download → ${download.status}`);
  expect(download.headers.get('referrer-policy') === 'no-referrer', '/order/<jeton>/download sans no-referrer');
});

/* ---------------------------------------------------- an unhandled error */

section('Une erreur non rattrapée reste une réponse');

await check('un 500 est durci, non mis en cache, et ne montre pas sa pile', async () => {
  const response = await get('/api/cart', { method: 'POST', headers: { origin: target.origin, 'content-type': 'application/octet-stream' }, body: 'x' });
  expect(response.status === 500, `statut ${response.status}`);
  expect(response.headers.get('cache-control') === 'private, no-store', `cache-control ${response.headers.get('cache-control')}`);
  expect(response.headers.get('x-content-type-options') === 'nosniff', 'pas de nosniff');
  const body = await response.text();
  expect(!LEAK.test(body), 'le corps montre une pile ou un détail interne');
});

/* ----------------------------------------------------------------- verdict */

console.log(`\n${passed} contrôle(s) passé(s), ${failures.length} en échec.`);
process.exit(failures.length === 0 ? 0 : 1);
