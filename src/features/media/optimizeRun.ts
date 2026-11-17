import { env } from 'cloudflare:workers';
import { getConfig } from '../../config';
import { purgeCacheTags } from '../cache/purge';
import { CACHE_TAG } from '../cache/tags';
import { logSafe } from '../observability/logSafe';
import { prewarmImageTransforms } from '../products/image';
import { getSetting } from '../settings/db';
import { getStorage } from '../storage';
import type { Media } from './db';
import { optimizeStoredMedia, tally, type OptimizeTally } from './optimize';

/**
 * The Worker's side of « Optimiser » (ticket #255), shared by the button under
 * one photo and the pass over every heavy one: the bindings, then what a
 * changed photo asks of the storefront once the batch is done.
 *
 * The caller has checked `env.IMAGES`; without it nothing here is reached.
 */
export async function runOptimizations(
  photos: Media[],
  total: OptimizeTally,
  context: { waitUntil?: (promise: Promise<unknown>) => void; origin: string },
): Promise<{ total: OptimizeTally; lastId: number }> {
  const images = env.IMAGES;
  if (!images) return { total, lastId: photos.at(-1)?.id ?? 0 };
  const config = getConfig().images;
  const storage = getStorage();

  const newKeys: string[] = [];
  let lastId = 0;
  for (const photo of photos) {
    const result = await optimizeStoredMedia(env.DB, storage, images, photo, config.maxWidth);
    total = tally(total, result);
    if (result.status === 'optimized') newKeys.push(result.newKey);
    lastId = photo.id;
  }
  if (newKeys.length === 0) return { total, lastId };

  // Any storefront page may show one of them: a card, a gallery, a category's
  // tile, a page, the logo in the shell. Every one carries both tags.
  await purgeCacheTags([CACHE_TAG.shell, CACHE_TAG.catalog]);

  // The responsive ladder of each new key, behind the response, as an upload
  // warms its own (src/pages/api/admin/media.ts).
  if (context.waitUntil && config.baseUrl) {
    const baseUrl = config.baseUrl;
    context.waitUntil(
      (async () => {
        if ((await getSetting(env.DB, 'image_delivery')) !== 'cloudflare') return;
        for (const key of newKeys) await prewarmImageTransforms(key, baseUrl, context.origin);
      })().catch((error) => console.error(JSON.stringify({ event: 'image_prewarm_failed', message: logSafe(error) }))),
    );
  }
  return { total, lastId };
}
