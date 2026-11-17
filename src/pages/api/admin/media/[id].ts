import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getMediaByPublicId, deleteMediaRecord } from '../../../../features/media/db';
import { mediaUsage, describeUsage } from '../../../../features/media/usage';
import { emptyTally, optimizeResultHref, readCursor } from '../../../../features/media/optimize';
import { runOptimizations } from '../../../../features/media/optimizeRun';
import { getStorage } from '../../../../features/storage';
import { parsePublicId } from '../../../../features/ids/publicId';
import { t } from '../../../../features/i18n';

export const prerender = false;

// POST /api/admin/media/:id — `_action=delete` removes a library item;
// `_action=optimize` gives one heavy photo a lighter file (ticket #255).
// :id is the med_ public ID; numeric row ids are not accepted.
// Deleting here is the ONLY way an image leaves storage with its row. An
// optimization replaces an object instead: the old one goes once nothing
// names it any more (features/media/optimize.ts).
export const POST: APIRoute = async ({ request, params, redirect, locals }) => {
  const publicId = parsePublicId(params.id, 'media');
  if (!publicId) return new Response(t('admin.media.error.invalidId'), { status: 400 });

  const form = await request.formData();
  const action = String(form.get('_action'));
  if (action !== 'delete' && action !== 'optimize') {
    return new Response(t('admin.media.error.unknownAction'), { status: 400 });
  }

  const wantsJson = request.headers.get('accept')?.includes('application/json');
  const media = await getMediaByPublicId(env.DB, publicId);
  if (!media) return new Response(t('admin.media.error.notFound'), { status: 404 });
  const id = media.id;

  if (action === 'optimize') {
    if (!env.IMAGES) {
      return redirect(`/admin/media?error=${encodeURIComponent(t('admin.media.optimize.error.binding'))}`, 303);
    }
    const ctx = locals.cfContext;
    const { total } = await runOptimizations([media], emptyTally(), {
      waitUntil: ctx ? (promise) => ctx.waitUntil(promise) : undefined,
      origin: new URL(request.url).origin,
    });
    // Back to the page of the grid the button was on.
    return redirect(optimizeResultHref({ state: 'done', total, page: readCursor(form.get('page')) }), 303);
  }

  // One guarded statement: it deletes only while nothing references the row, so
  // there is no window between checking and deleting. A null result means it
  // refused — resolve usage afterwards purely to explain why.
  const deletedKey = await deleteMediaRecord(env.DB, id);
  if (!deletedKey) {
    const usage = await mediaUsage(env.DB, id);
    const message = t('admin.media.error.inUse', { usages: describeUsage(usage) });
    return wantsJson
      ? new Response(JSON.stringify({ error: message }), {
          status: 409,
          headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
        })
      : redirect(`/admin/media?error=${encodeURIComponent(message)}`, 303);
  }

  // Row first, object second. A failed object delete leaves an invisible orphan;
  // the reverse order would leave a live row pointing at a missing file, which
  // shows as a broken image everywhere it was used.
  try {
    await getStorage().delete(deletedKey);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'media_object_delete_failed',
        mediaId: id,
        key: deletedKey,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return wantsJson
    ? new Response(JSON.stringify({ deleted: publicId }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
      })
    : redirect('/admin/media', 303);
};
