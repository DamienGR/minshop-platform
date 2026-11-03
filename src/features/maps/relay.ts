import { tileServerUrl, type Tile } from './tiles.ts';

/**
 * The shop's relay to the tile server (ADR 0029). No binding: the caller hands
 * in `fetch`, so the unit tests stand in for the server.
 *
 * Why relay at all: a map whose tiles the visitor's browser fetched from the
 * tile server would send that server every visitor's address, with the page
 * they read as the Referer — a third party the merchant would have to name in
 * their privacy policy. Relayed, the visitor talks to the shop alone, and the
 * tile server sees one client per shop.
 *
 * What OpenStreetMap's tile policy asks of a relay
 * (operations.osmfoundation.org/policies/tiles), and where this does it:
 *  - a User-Agent that names the application and a way to reach it, never a
 *    library's default — `relayUserAgent()`, which carries the shop's origin;
 *  - a Referer it does not strip — the shop's own origin;
 *  - its caching headers honoured, seven days when they cannot be read —
 *    `tileCacheControl()`, which the route's Cache API entry and the browser
 *    both obey;
 *  - no tile fetched that nobody is looking at — the route relays a tile only
 *    on a visitor's request, and only one that a published map draws.
 */

/** What a server's tile weighs at most. A real one is 5–60 KB. */
export const MAX_TILE_BYTES = 512 * 1024;

/** Long enough for a slow tile render, short enough that a page never waits on a dead server. */
export const RELAY_TIMEOUT_MS = 8_000;

/** The policy's floor when the server sends no readable freshness. */
export const DEFAULT_TILE_TTL = 7 * 24 * 3600;
const MAX_TILE_TTL = 365 * 24 * 3600;

export function relayUserAgent(origin: string): string {
  return `minshop-map-relay/1 (+${origin}/)`;
}

/**
 * Our Cache-Control for a relayed tile, from the server's headers: its own
 * freshness (s-maxage, max-age, or Expires against Date), seven days when
 * none is readable, nothing at all when it said not to store.
 */
export function tileCacheControl(headers: Headers): string {
  const directives = (headers.get('cache-control') ?? '').toLowerCase();
  if (/(?:^|,)\s*(?:no-store|no-cache|private)\b/.test(directives)) return 'no-store';

  const shared = /(?:^|,)\s*s-maxage\s*=\s*"?(\d+)/.exec(directives);
  const own = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/.exec(directives);
  let ttl: number | null = shared ? Number(shared[1]) : own ? Number(own[1]) : null;
  if (ttl === null) {
    const expires = Date.parse(headers.get('expires') ?? '');
    const date = Date.parse(headers.get('date') ?? '');
    if (Number.isFinite(expires)) {
      ttl = Math.max(0, Math.round((expires - (Number.isFinite(date) ? date : Date.now())) / 1000));
    }
  }
  if (ttl === null) ttl = DEFAULT_TILE_TTL;
  if (ttl <= 0) return 'no-store';
  return `public, max-age=${Math.min(ttl, MAX_TILE_TTL)}`;
}

const IMAGE_TYPE = /^image\/(?:png|jpeg|webp)$/;

export interface RelayOptions {
  fetch: typeof fetch;
  /** The `{z}/{x}/{y}` template from config.maps.tileUrl. */
  tileUrl: string;
  /** The shop's public origin, without a trailing slash. */
  origin: string;
  timeoutMs?: number;
}

/** A tile the server could not give. Never cached: the next visitor tries again. */
function unavailable(reason: string, status?: number): Response {
  // Fields chosen here, never the server's body (invariant 12): a tile names
  // no one, but the rule is the rule.
  console.warn(JSON.stringify({ event: 'map_tile_unavailable', reason, ...(status ? { status } : {}) }));
  return new Response(null, { status: 502, headers: { 'cache-control': 'no-store' } });
}

/** Fetch one tile from the server and hand it on, with our cache policy. */
export async function relayTile(tile: Tile, options: RelayOptions): Promise<Response> {
  // Called detached: `options.fetch(…)` would hand workerd's fetch `options`
  // as its receiver, and it throws « Illegal invocation » on anything but the
  // global object.
  const fetchTile = options.fetch;
  let upstream: Response;
  try {
    upstream = await fetchTile(tileServerUrl(options.tileUrl, tile), {
      headers: {
        'user-agent': relayUserAgent(options.origin),
        referer: `${options.origin}/`,
        accept: 'image/png,image/webp,image/jpeg;q=0.9',
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? RELAY_TIMEOUT_MS),
    });
  } catch {
    return unavailable('unreachable');
  }
  if (!upstream.ok) return unavailable('status', upstream.status);

  const type = (upstream.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPE.test(type)) return unavailable('type');
  const declared = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_TILE_BYTES) return unavailable('size');
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_TILE_BYTES) return unavailable('size');

  const headers = new Headers({
    'content-type': type,
    'cache-control': tileCacheControl(upstream.headers),
  });
  // Validators ride along, so a browser revalidating a stale tile gets a 304
  // from the edge cache rather than the bytes again.
  for (const name of ['etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(body, { status: 200, headers });
}
