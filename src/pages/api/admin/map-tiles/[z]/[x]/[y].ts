import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig } from '../../../../../../config';
import { serveTile } from '../../../../../../features/maps/serve';
import { parseTile } from '../../../../../../features/maps/tiles';
import { publicOrigin } from '../../../../../../features/http/origin';

export const prerender = false;

/**
 * GET /api/admin/map-tiles/<z>/<x>/<y> — the editor preview's tiles (ADR 0029).
 *
 * The preview draws a body that no published page holds yet, so the
 * storefront route would refuse its tiles. This one stands behind the admin
 * gate instead: whoever is signed in may make the shop fetch any tile, which
 * is what a merchant moving a pin around needs. It shares the storefront's
 * cache entries, so a map previewed is a map already cached when it goes live.
 */
export const GET: APIRoute = async ({ params, request, url, locals }) => {
  const tile = parseTile(params.z, params.x, params.y);
  if (!tile) return new Response(null, { status: 404 });
  return serveTile({
    request,
    requestOrigin: url.origin,
    publicOrigin: publicOrigin(url.origin, env.CANONICAL_ORIGIN),
    tile,
    fetch,
    tileUrl: getConfig().maps.tileUrl,
    allowed: async () => true,
    waitUntil: locals.cfContext ? (promise) => locals.cfContext.waitUntil(promise) : undefined,
  });
};
