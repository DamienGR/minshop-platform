import { relayTile, type RelayOptions } from './relay.ts';
import type { Tile } from './tiles.ts';

/**
 * One tile, from the edge cache or through the relay (ADR 0029). Shared by the
 * storefront's route and the admin preview's, which differ only in who may
 * cause a fetch from the tile server.
 *
 * The cache key is the tile alone, not the route that asked: a tile is the
 * same picture whichever page draws it, so the preview's fetch serves the page
 * once it is published, and two pages around one market share their tiles.
 */
export interface ServeTileOptions extends Omit<RelayOptions, 'origin'> {
  request: Request;
  /** The request's own origin: the Cache API stores per zone. */
  requestOrigin: string;
  /** The shop's public origin, which the relay names to the tile server. */
  publicOrigin: string;
  tile: Tile;
  /** Asked on a cache miss only: may this request make the shop fetch the tile? */
  allowed: () => Promise<boolean>;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export function tileCacheKey(origin: string, tile: Tile): Request {
  return new Request(`${origin}/map-tiles/${tile.z}/${tile.x}/${tile.y}`);
}

export async function serveTile(options: ServeTileOptions): Promise<Response> {
  // Absent under `astro dev`. GET only: Astro answers HEAD with the GET
  // handler, and `cache.put` rejects a HEAD (see src/pages/images/[...key].ts).
  const cache =
    typeof caches !== 'undefined' && options.request.method === 'GET' ? caches.default : null;
  const key = tileCacheKey(options.requestOrigin, options.tile);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  if (!(await options.allowed())) {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  const response = await relayTile(options.tile, {
    fetch: options.fetch,
    tileUrl: options.tileUrl,
    origin: options.publicOrigin,
    timeoutMs: options.timeoutMs,
  });
  if (cache && options.waitUntil && response.status === 200 && response.headers.get('cache-control') !== 'no-store') {
    options.waitUntil(cache.put(key, response.clone()));
  }
  return response;
}
