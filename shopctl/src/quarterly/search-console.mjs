/**
 * Search, from Google Search Console (ADR 0035): how often the shop appeared
 * in Google's results, how often it was clicked, for which searches and which
 * pages, and how many of its sitemap's pages Google has indexed.
 *
 * One Google service account serves the whole fleet: the agency adds its
 * address to each shop's property (a Domain property, `sc-domain:<domain>`,
 * verified by a TXT record at the merchant's DNS) as a « Restreint » user, and
 * its JSON key lives in the fleet's `report` environment as
 * GSC_SERVICE_ACCOUNT_JSON. Where an organisation forbids service account
 * keys, GSC_ACCESS_TOKEN takes a token obtained otherwise.
 *
 * No dependency: the token is a JWT signed with node:crypto and exchanged at
 * Google's token endpoint, the API is three JSON endpoints. Read-only scope.
 */
import { createSign } from 'node:crypto';
import { externalError, inputError } from '../errors.mjs';

export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://searchconsole.googleapis.com';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const TIMEOUT = 20_000;

/** Pages inspected at most: Google allows 2 000 a day per property, and a run
 *  that takes minutes for the long tail of a catalogue says little more. */
export const INSPECTION_LIMIT = 60;
const INSPECTION_CONCURRENCY = 4;

const base64url = (input) => Buffer.from(input).toString('base64url');

/** The service account key, checked. */
export function parseServiceAccount(text) {
  let document;
  try {
    document = JSON.parse(String(text ?? ''));
  } catch {
    throw inputError('GSC_SERVICE_ACCOUNT_JSON n\'est pas du JSON.', 'Collez le fichier de clé entier, accolades comprises.');
  }
  const clientEmail = document?.client_email;
  const privateKey = document?.private_key;
  if (typeof clientEmail !== 'string' || typeof privateKey !== 'string' || !privateKey.includes('PRIVATE KEY')) {
    throw inputError('GSC_SERVICE_ACCOUNT_JSON n\'est pas la clé d\'un compte de service.', 'Google Cloud → IAM → Comptes de service → Clés → Ajouter une clé → JSON.');
  }
  return { clientEmail, privateKey, tokenUri: typeof document.token_uri === 'string' ? document.token_uri : TOKEN_URI };
}

/** The signed JWT Google exchanges for an access token (RFC 7523). */
export function signedAssertion(account, now = new Date()) {
  const issued = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: account.clientEmail, scope: GSC_SCOPE, aud: account.tokenUri, iat: issued, exp: issued + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(account.privateKey).toString('base64url')}`;
}

async function call(fetchImpl, url, init, what) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (error) {
    throw externalError(`Google est injoignable (${what}).`, error?.cause?.code ?? error?.name ?? 'erreur réseau');
  }
  let document = null;
  try {
    document = await response.json();
  } catch {
    // The status says it.
  }
  return { status: response.status, ok: response.ok, document };
}

/** An access token, from GSC_ACCESS_TOKEN or the service account. */
export async function accessToken(env, { fetchImpl = fetch, now = new Date() } = {}) {
  if (env.GSC_ACCESS_TOKEN) return env.GSC_ACCESS_TOKEN;
  const account = parseServiceAccount(env.GSC_SERVICE_ACCOUNT_JSON);
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signedAssertion(account, now) });
  const answer = await call(fetchImpl, account.tokenUri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }, 'jeton');
  if (answer.ok && typeof answer.document?.access_token === 'string') return answer.document.access_token;
  throw externalError(
    `Google refuse le jeton du compte de service (HTTP ${answer.status}).`,
    'Clé supprimée ou désactivée : créez une clé du compte de service et remplacez GSC_SERVICE_ACCOUNT_JSON.',
  );
}

/**
 * The property that covers a host, among those the account sees: the Domain
 * property of the host or of a parent domain first (it covers every protocol
 * and subdomain), then the URL-prefix property of `https://<host>/`.
 */
export function chooseProperty(sites, host) {
  const usable = new Set((sites ?? []).filter((site) => site?.siteUrl && site.permissionLevel !== 'siteUnverifiedUser').map((site) => site.siteUrl));
  const labels = String(host).toLowerCase().split('.');
  for (let index = 0; index <= labels.length - 2; index += 1) {
    const candidate = `sc-domain:${labels.slice(index).join('.')}`;
    if (usable.has(candidate)) return candidate;
  }
  for (const candidate of [`https://${host}/`, `https://www.${host}/`]) if (usable.has(candidate)) return candidate;
  return null;
}

/** The `<loc>`s of a sitemap, and whether it is an index of sitemaps. */
export function sitemapLocs(xml) {
  const text = String(xml ?? '');
  const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) =>
    match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"),
  );
  return { index: /<sitemapindex[\s>]/.test(text), locs };
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/** One searchAnalytics row, as figures. */
function figures(row) {
  return {
    clicks: Number(row?.clicks ?? 0),
    impressions: Number(row?.impressions ?? 0),
    ctr: Number(row?.ctr ?? 0),
    position: row?.position == null ? null : round(Number(row.position), 1),
  };
}

/**
 * The period's search figures.
 *
 * @param {{ domain: string, period: object, env?: object, fetchImpl?: typeof fetch, now?: Date }} options
 */
export async function readSearch({ domain, period, env = process.env, fetchImpl = fetch, now = new Date() }) {
  if (!env.GSC_SERVICE_ACCOUNT_JSON && !env.GSC_ACCESS_TOKEN) {
    return { status: 'absent', reason: 'aucune clé de compte de service Google (GSC_SERVICE_ACCOUNT_JSON) dans l\'environnement' };
  }
  const token = await accessToken(env, { fetchImpl, now });
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const ask = async (path, init, what) => {
    const answer = await call(fetchImpl, `${API}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } }, what);
    if (answer.ok) return answer.document ?? {};
    const reason = String(answer.document?.error?.message ?? '').slice(0, 200);
    throw externalError(
      `Search Console, ${what} : ${answer.status}${reason ? ` (${reason})` : ''}.`,
      answer.status === 403
        ? 'L\'API Search Console n\'est pas activée dans le projet Google Cloud du compte de service, ou la propriété ne lui est pas partagée.'
        : null,
    );
  };

  let property = env.GSC_PROPERTY || null;
  if (!property) {
    const listed = await ask('/webmasters/v3/sites', {}, 'propriétés');
    property = chooseProperty(listed.siteEntry, domain);
    if (!property) {
      throw externalError(
        `aucune propriété Search Console accessible au compte de service ne couvre ${domain}.`,
        'Ajoutez son adresse à la propriété (Paramètres → Utilisateurs et autorisations, Restreint), ou posez GSC_PROPERTY.',
      );
    }
  }
  const site = encodeURIComponent(property);
  const query = (span, extra, what) =>
    ask(
      `/webmasters/v3/sites/${site}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startDate: span.from, endDate: span.to, type: 'web', dataState: period.partial ? 'all' : 'final', ...extra }),
      },
      what,
    );

  const totals = figures((await query(period, {}, 'totaux')).rows?.[0]);
  const previous = period.previous ? figures((await query(period.previous, {}, 'totaux du trimestre précédent')).rows?.[0]) : null;
  const top = async (dimension, what) =>
    ((await query(period, { dimensions: [dimension], rowLimit: 10 }, what)).rows ?? []).map((row) => ({ key: String(row.keys?.[0] ?? ''), ...figures(row) }));
  const queries = await top('query', 'requêtes');
  const pages = await top('page', 'pages');

  return { status: 'ok', property, totals, previous, queries, pages, indexing: await readIndexing({ domain, property, ask, fetchImpl }) };
}

/**
 * How many of the sitemap's pages Google says it has indexed, on the first
 * INSPECTION_LIMIT of them. A failure here is said in the section and the
 * figures above still stand.
 */
async function readIndexing({ domain, property, ask, fetchImpl }) {
  let locs;
  try {
    const answer = await fetchImpl(`https://${domain}/sitemap.xml`, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
    const sitemap = sitemapLocs(await answer.text());
    locs = sitemap.locs;
    if (sitemap.index) {
      const children = [];
      for (const child of locs.slice(0, 5)) {
        const page = await fetchImpl(child, { signal: AbortSignal.timeout(TIMEOUT) });
        if (page.ok) children.push(...sitemapLocs(await page.text()).locs);
      }
      locs = children;
    }
  } catch (error) {
    return { error: `le sitemap publié ne répond pas (${error.message ?? error})` };
  }
  const sample = [...new Set(locs)].slice(0, INSPECTION_LIMIT);
  const results = new Array(sample.length);
  let next = 0;
  let failure = null;
  const worker = async () => {
    while (next < sample.length && !failure) {
      const index = next;
      next += 1;
      try {
        const document = await ask(
          '/v1/urlInspection/index:inspect',
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inspectionUrl: sample[index], siteUrl: property, languageCode: 'fr-FR' }) },
          'inspection',
        );
        const status = document.inspectionResult?.indexStatusResult ?? {};
        results[index] = { verdict: status.verdict ?? 'VERDICT_UNSPECIFIED', state: status.coverageState ?? 'inconnu' };
      } catch (error) {
        failure = error.message;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(INSPECTION_CONCURRENCY, sample.length) }, worker));
  if (failure) return { error: failure, total: locs.length };
  const states = new Map();
  for (const result of results.filter((entry) => entry && entry.verdict !== 'PASS')) states.set(result.state, (states.get(result.state) ?? 0) + 1);
  return {
    total: new Set(locs).size,
    checked: sample.length,
    indexed: results.filter((entry) => entry?.verdict === 'PASS').length,
    states: [...states].map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count),
  };
}
