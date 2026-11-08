import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  createCategory,
  getCategory,
  getCategoryByPublicId,
  setCategoryImage,
} from '../../../features/categories/db';
import { parseCategoryForm } from '../../../features/categories/form';
import { uniqueCategorySlug } from '../../../features/categories/slug';
import { CACHE_TAG } from '../../../features/cache/tags';
import { purgeCacheTags } from '../../../features/cache/purge';
import { t } from '../../../features/i18n';

export const prerender = false;

const fail = (msg: string) => `/admin/categories/new?error=${encodeURIComponent(msg)}`;

// POST /api/admin/categories — create a category, then redirect to the list.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const parsed = parseCategoryForm(form);
  if ('error' in parsed) return redirect(fail(parsed.error), 303);

  // The parent selector submits a cat_ public ID; resolve it to the row id here
  // at the boundary — relationship writes stay integer internally.
  let parentId: number | null = null;
  if (parsed.data.parentPublicId) {
    const parent = await getCategoryByPublicId(env.DB, parsed.data.parentPublicId);
    if (!parent) return redirect(fail(t('admin.categories.error.parentGone')), 303);
    parentId = parent.id;
  }

  const slug = await uniqueCategorySlug(env.DB, parsed.data.slugInput || parsed.data.name);
  const id = await createCategory(env.DB, {
    name: parsed.data.name,
    slug,
    parent_id: parentId,
    description: parsed.data.description,
    seo_title: parsed.data.seo_title,
    seo_description: parsed.data.seo_description,
  });
  // The image is written apart, through the statement that sources it from
  // `media` (invariant 10). A file deleted meanwhile leaves the category
  // without one, and the edit screen says so.
  const imageSet = !parsed.data.imageKey || (await setCategoryImage(env.DB, id, parsed.data.imageKey));
  await purgeCacheTags([CACHE_TAG.catalog]);
  if (!imageSet) {
    const created = await getCategory(env.DB, id);
    return redirect(
      `/admin/categories/${created?.public_id}/edit?error=${encodeURIComponent(t('admin.categories.error.imageGone'))}`,
      303,
    );
  }
  return redirect('/admin/categories', 303);
};
