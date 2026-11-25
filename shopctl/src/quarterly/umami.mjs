/**
 * The audience, from Umami (ADR 0034, ADR 0035): how many visitors, which
 * pages, where from.
 *
 * The shop says which Umami and which site: Admin → Réglages → Mesure
 * d'audience stores the tracker's address and the website ID in D1, and the
 * report reads them there. The agency holds the key: one key for every shop
 * the agency's Umami (or its Umami Cloud team) can see, in the fleet's
 * `report` environment.
 *
 *   Umami Cloud      tracker on cloud.umami.is, API at api.umami.is/v1,
 *                    the key in `x-umami-api-key`
 *   its own server   tracker at https://<host>/…, API at https://<host>/api,
 *                    the key as a bearer token (such a server ignores
 *                    `x-umami-api-key` and answers 401, the key never
 *                    marked used), or a login (UMAMI_USERNAME and
 *                    UMAMI_PASSWORD) exchanged for one
 *
 * UMAMI_API_URL and UMAMI_WEBSITE_ID override what the shop says, for a server
 * whose API is not where its tracker is.
 *
 * Read-only, and lenient about shapes: Umami 2 answers a statistic as
 * `{ value, prev }`, later versions as a number, and its metric for pages is
 * `url` before Umami 3 and `path` since.
 */
import { externalError, preconditionError } from '../errors.mjs';

const TIMEOUT = 20_000;

/** Where the API of the Umami that serves a tracker is. */
export function umamiApiBase(scriptUrl, override = null) {
  if (override) return String(override).replace(/\/+$/, '');
  let url;
  try {
    url = new URL(String(scriptUrl ?? ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (isUmamiCloud(url.hostname)) return 'https://api.umami.is/v1';
  return `${url.origin}/api`;
}

function isUmamiCloud(hostname) {
  return hostname === 'umami.is' || hostname.endsWith('.umami.is');
}

/** How a key goes to that API: Umami Cloud's header, or a bearer token. */
export function keyHeaders(base, key) {
  let hostname = '';
  try {
    hostname = new URL(base).hostname;
  } catch {
    // An unreadable base is no Umami Cloud.
  }
  return isUmamiCloud(hostname) ? { 'x-umami-api-key': key } : { authorization: `Bearer ${key}` };
}

/** A statistic, whatever the version: a number, or `{ value }`. */
export function statValue(stat) {
  if (typeof stat === 'number' && Number.isFinite(stat)) return stat;
  if (stat && typeof stat === 'object' && typeof stat.value === 'number') return stat.value;
  return 0;
}

/** `/websites/:id/stats`, as figures. Durations in seconds. */
export function summariseStats(stats) {
  const visits = statValue(stats?.visits);
  const bounces = statValue(stats?.bounces);
  const totaltime = statValue(stats?.totaltime);
  return {
    visitors: statValue(stats?.visitors),
    visits,
    pageviews: statValue(stats?.pageviews),
    bounceRate: visits > 0 ? bounces / visits : null,
    averageVisitSeconds: visits > 0 ? Math.round(totaltime / visits) : null,
  };
}

/** `/websites/:id/metrics`, as `[{ x, y }]`, the first `limit`. */
export function summariseMetrics(answer, limit = 10) {
  const rows = Array.isArray(answer) ? answer : Array.isArray(answer?.data) ? answer.data : [];
  return rows
    .map((row) => ({ x: row?.x == null ? '' : String(row.x), y: Number(row?.y ?? 0) }))
    .filter((row) => Number.isFinite(row.y))
    .sort((a, b) => b.y - a.y)
    .slice(0, limit);
}

/**
 * The credentials this run has, or null when it has none: the section then
 * says the source is not connected, which is not an error.
 */
export function umamiCredentials(env = process.env) {
  if (env.UMAMI_API_KEY) return { kind: 'key', key: env.UMAMI_API_KEY };
  if (env.UMAMI_USERNAME && env.UMAMI_PASSWORD) return { kind: 'login', username: env.UMAMI_USERNAME, password: env.UMAMI_PASSWORD };
  return null;
}

async function call(fetchImpl, url, init, what) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (error) {
    throw externalError(`Umami est injoignable (${what}).`, error?.cause?.code ?? error?.name ?? 'erreur réseau');
  }
  let document = null;
  try {
    document = await response.json();
  } catch {
    // The status says it.
  }
  return { status: response.status, ok: response.ok, document };
}

async function authenticate(base, credentials, fetchImpl) {
  if (credentials.kind === 'key') return keyHeaders(base, credentials.key);
  const answer = await call(
    fetchImpl,
    `${base}/auth/login`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: credentials.username, password: credentials.password }) },
    'connexion',
  );
  if (answer.ok && answer.document?.token) return { authorization: `Bearer ${answer.document.token}` };
  if (answer.document?.requireTwoFactor || answer.document?.mfa) {
    throw preconditionError('Umami demande une double authentification pour ce compte.', 'Utilisez une clé d\'API (UMAMI_API_KEY) plutôt qu\'un compte.');
  }
  throw externalError(`Umami refuse la connexion (HTTP ${answer.status}).`, 'Vérifiez UMAMI_USERNAME et UMAMI_PASSWORD, ou posez UMAMI_API_KEY.');
}

/**
 * The period's audience, and the previous quarter's for comparison.
 *
 * @param {{ scriptUrl: string|null, websiteId: string|null }} site from the shop's settings
 * @param {{ start: Date, end: Date, previous: { start: Date, end: Date }|null }} period
 * @param {{ env?: object, fetchImpl?: typeof fetch }} options
 * @returns {Promise<{ status: 'absent', reason: string } | { status: 'ok', … }>}
 */
export async function readAudience(site, period, { env = process.env, fetchImpl = fetch } = {}) {
  const websiteId = env.UMAMI_WEBSITE_ID || site.websiteId;
  if (!websiteId) return { status: 'absent', reason: 'la boutique ne mesure pas son audience (Réglages → Mesure d\'audience)' };
  const credentials = umamiCredentials(env);
  if (!credentials) return { status: 'absent', reason: 'aucune clé Umami (UMAMI_API_KEY) dans l\'environnement' };
  const base = umamiApiBase(site.scriptUrl, env.UMAMI_API_URL || null);
  if (!base) return { status: 'absent', reason: 'l\'adresse du traceur ne dit pas où est l\'API d\'Umami (UMAMI_API_URL)' };
  const headers = { accept: 'application/json', ...(await authenticate(base, credentials, fetchImpl)) };
  const website = `${base}/websites/${encodeURIComponent(websiteId)}`;
  const range = (span) => `startAt=${span.start.getTime()}&endAt=${span.end.getTime()}`;

  const get = async (path, what) => {
    const answer = await call(fetchImpl, `${website}${path}`, { headers }, what);
    if (answer.ok) return answer.document;
    if (answer.status === 401 || answer.status === 403) {
      throw externalError(`Umami, ${what} : ${answer.status}.`, 'Clé révoquée, ou compte qui ne voit pas ce site : une nouvelle clé, ou l\'accès au site.');
    }
    if (answer.status === 404) throw externalError(`Umami ne connaît pas le site ${websiteId}.`, 'Vérifiez l\'identifiant du site dans Réglages → Mesure d\'audience.');
    const error = new Error(`HTTP ${answer.status}`);
    error.status = answer.status;
    throw error;
  };
  const metric = async (types, span) => {
    for (const [index, type] of types.entries()) {
      try {
        return summariseMetrics(await get(`/metrics?${range(span)}&type=${type}&limit=10`, `métrique ${type}`));
      } catch (error) {
        // Umami 3 renamed `url` to `path`: a 400 on the first name is the
        // version speaking, not a failure.
        if (error.status === 400 && index < types.length - 1) continue;
        if (error.status) throw externalError(`Umami, métrique ${type} : ${error.message}.`);
        throw error;
      }
    }
    return [];
  };
  const stats = async (span) => {
    try {
      return summariseStats(await get(`/stats?${range(span)}`, 'statistiques'));
    } catch (error) {
      if (error.status) throw externalError(`Umami, statistiques : ${error.message}.`);
      throw error;
    }
  };

  let since = null;
  try {
    const created = (await get('', 'site'))?.createdAt;
    const date = created ? new Date(created) : null;
    if (date && !Number.isNaN(date.getTime()) && date > period.start && date < period.end) since = date.toISOString();
  } catch (error) {
    if (!error.status) throw error;
  }

  return {
    status: 'ok',
    websiteId,
    measuredSince: since,
    ...(await stats(period)),
    // A site created during the period has no previous quarter to compare.
    previous: period.previous && !since ? await stats(period.previous) : null,
    pages: await metric(['path', 'url'], period),
    referrers: await metric(['referrer'], period),
  };
}
