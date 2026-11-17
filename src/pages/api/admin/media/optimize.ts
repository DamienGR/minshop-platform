import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig } from '../../../../config';
import {
  OPTIMIZE_BATCH,
  countOptimizableAfter,
  listOptimizable,
  optimizeResultHref,
  readCursor,
  readTally,
} from '../../../../features/media/optimize';
import { runOptimizations } from '../../../../features/media/optimizeRun';
import { t } from '../../../../features/i18n';

export const prerender = false;

// POST /api/admin/media/optimize — one step of « Optimiser les photos lourdes »
// (ticket #255). A pass is a series of plain form posts: each optimizes the
// next OPTIMIZE_BATCH heavy photos after the cursor `after`, and redirects to
// Médias with the cursor and the running tally, which « Continuer » posts back.
// Bounded per request by D1's statements per invocation, and per pass by the
// cursor: a photo that fails is not marked, and the next pass offers it again.
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const form = await request.formData();
  if (!env.IMAGES) {
    return redirect(`/admin/media?error=${encodeURIComponent(t('admin.media.optimize.error.binding'))}`, 303);
  }

  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : null;
  };
  const after = readCursor(field('after'));
  const maxWidth = getConfig().images.maxWidth;

  const photos = await listOptimizable(env.DB, maxWidth, after, OPTIMIZE_BATCH);
  if (photos.length === 0) {
    return redirect(optimizeResultHref({ state: 'done', total: readTally(field) }), 303);
  }

  const ctx = locals.cfContext;
  const { total, lastId } = await runOptimizations(photos, readTally(field), {
    waitUntil: ctx ? (promise) => ctx.waitUntil(promise) : undefined,
    origin: new URL(request.url).origin,
  });
  const remaining = await countOptimizableAfter(env.DB, maxWidth, lastId);
  return redirect(
    optimizeResultHref({ state: remaining > 0 ? 'running' : 'done', total, after: lastId, remaining }),
    303,
  );
};
