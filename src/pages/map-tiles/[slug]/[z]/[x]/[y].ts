import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig } from '../../../../../config';
import { getPublishedPageBySlug } from '../../../../../features/pages/db';
import { placeMapsDrawTile } from '../../../../../features/pages/markdown';
import { serveTile } from '../../../../../features/maps/serve';
import { parseTile } from '../../../../../features/maps/tiles';
import { publicOrigin } from '../../../../../features/http/origin';

export const prerender = false;

/**
 * GET /map-tiles/<page slug>/<z>/<x>/<y> — one tile of a published page's map
 * (ADR 0029), relayed from the tile server and kept in the edge cache.
 *
 * The page in the path is what bounds the relay: on a cache miss the tile is
 * fetched only if a ```carte block of that PUBLISHED page draws it. Any other
 * tile, a draft's, or a malformed path is a 404 that costs one indexed read and
 * no request to the tile server — the same as a missing page.
 */
export const GET: APIRoute = async ({ params, request, url, locals }) => {
  const tile = parseTile(params.z, params.x, params.y);
  const slug = params.slug;
  if (!tile || !slug) {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  return serveTile({
    request,
    requestOrigin: url.origin,
    publicOrigin: publicOrigin(url.origin, env.CANONICAL_ORIGIN),
    tile,
    fetch,
    tileUrl: getConfig().maps.tileUrl,
    allowed: async () => {
      const page = await getPublishedPageBySlug(env.DB, slug);
      return page !== null && placeMapsDrawTile(page.body_markdown, tile);
    },
    waitUntil: locals.cfContext ? (promise) => locals.cfContext.waitUntil(promise) : undefined,
  });
};
