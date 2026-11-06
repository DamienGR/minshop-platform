import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig } from '../../../../config';
import { getPageByPublicId, deletePage } from '../../../../features/pages/db';
import { parsePageForm } from '../../../../features/pages/form';
import { uniquePageSlug } from '../../../../features/pages/slug';
import { savePageBody, saveWarning } from '../../../../features/pages/save';
import { refusesIncompletePages } from '../../../../features/pages/completeness';
import { parsePublicId } from '../../../../features/ids/publicId';
import { CACHE_TAG } from '../../../../features/cache/tags';
import { purgeCacheTags } from '../../../../features/cache/purge';
import { t } from '../../../../features/i18n';
import { activePageModels } from '../../../../features/pageModels/active';
import { pageModelOf } from '../../../../features/pageModels/declaration';
import { readStoredZones, ZONE_MOVE } from '../../../../features/pageModels/zones';

export const prerender = false;

// POST /api/admin/pages/:id — save, or delete when `_action=delete`.
// :id is the page_ public ID; numeric row ids are not accepted.
export const POST: APIRoute = async ({ request, params, redirect }) => {
  const publicId = parsePublicId(params.id, 'page');
  const existing = publicId ? await getPageByPublicId(env.DB, publicId) : null;
  if (!existing) return new Response(t('admin.pages.notFound'), { status: 404 });
  const id = existing.id;

  const form = await request.formData();

  if (String(form.get('_action')) === 'delete') {
    // Drops the page and its media associations. The files stay in the library.
    await deletePage(env.DB, id);
    await purgeCacheTags([CACHE_TAG.shell]);
    return redirect('/admin/pages', 303);
  }

  const back = (query: string) => redirect(`/admin/pages/${publicId}/edit${query}`, 303);

  // The theme's models (ADR 0031): the fields on screen were the zones of the
  // model the page had, and the others it keeps stay as they are.
  const parsed = parsePageForm(form, {
    models: activePageModels,
    stored: { model: existing.model, zones: readStoredZones(existing.zones) },
  });
  if ('error' in parsed) return back(`?error=${encodeURIComponent(parsed.error)}`);

  // Keep the slug stable on rename: the form pre-fills the current slug.
  const slugBase = parsed.data.slug || existing.slug || parsed.data.title;
  const slug = await uniquePageSlug(env.DB, slugBase, id);

  // A production refuses to put a page still carrying `[À COMPLÉTER]` markers live.
  const result = await savePageBody(
    env.DB,
    existing,
    { ...parsed.data, slug },
    {
      baseUrl: getConfig().images.baseUrl,
      refuseIncomplete: refusesIncompletePages(env.MINSHOP_ENV),
      pageModel: pageModelOf(activePageModels, parsed.data.model),
    },
  );

  await purgeCacheTags([CACHE_TAG.shell]);
  const warning = saveWarning(result);
  // « Monter » and « Descendre » save the page too: bring the editor back to
  // the list they moved, not to the top of a long form.
  const moved = /^(?:up|down):([a-zA-Z0-9]+):/.exec(String(form.get(ZONE_MOVE) ?? ''))?.[1];
  const anchor = moved ? `#zone-${moved}` : '';
  return back((warning ? `?warning=${encodeURIComponent(warning)}` : '?saved=1') + anchor);
};
