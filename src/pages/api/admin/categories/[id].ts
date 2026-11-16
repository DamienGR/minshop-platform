import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  updateCategory,
  deleteCategory,
  moveCategory,
  descendantIds,
  getCategoryByPublicId,
  setCategoryImage,
  listProductsForOrdering,
  saveProductOrder,
  clearProductOrder,
} from '../../../../features/categories/db';
import { applyRanks, parseRank } from '../../../../features/categories/productOrder';
import { parseCategoryForm } from '../../../../features/categories/form';
import { uniqueCategorySlug } from '../../../../features/categories/slug';
import { parsePublicId } from '../../../../features/ids/publicId';
import { CACHE_TAG } from '../../../../features/cache/tags';
import { purgeCacheTags } from '../../../../features/cache/purge';
import { t } from '../../../../features/i18n';

export const prerender = false;

// POST /api/admin/categories/:id — update, delete when `_action=delete`,
// move a rank among its siblings when `_action=move` (ticket #228), or save or
// remove the order of its products, `_action=productOrder` and
// `_action=clearProductOrder` (ticket #239).
// :id is the cat_ public ID; numeric row ids are not accepted.
export const POST: APIRoute = async ({ request, params, redirect }) => {
  const publicId = parsePublicId(params.id, 'category');
  const category = publicId ? await getCategoryByPublicId(env.DB, publicId) : null;
  if (!category) return new Response(t('admin.categories.notFound'), { status: 404 });
  const id = category.id;

  const form = await request.formData();

  if (String(form.get('_action')) === 'delete') {
    await deleteCategory(env.DB, id);
    await purgeCacheTags([CACHE_TAG.catalog]);
    return redirect('/admin/categories', 303);
  }

  if (String(form.get('_action')) === 'move') {
    // Already first or last moves nothing, and needs no purge.
    const moved = await moveCategory(env.DB, id, form.get('direction') === 'up' ? 'up' : 'down');
    if (moved) await purgeCacheTags([CACHE_TAG.catalog]);
    return redirect(`/admin/categories#${publicId}`, 303);
  }

  if (String(form.get('_action')) === 'productOrder') {
    // Admin → Catégories → « Ordre des produits » (ticket #239): the list as
    // it was shown, in `product`, and the rank typed for each. Only products
    // the category's page can show are kept, whatever the form names.
    const back = `/admin/categories/${publicId}/products`;
    const { products } = await listProductsForOrdering(env.DB, id);
    const byPublicId = new Map(products.map((p) => [p.public_id, p.id]));
    const shown = [
      ...new Set(
        form
          .getAll('product')
          .map((value) => byPublicId.get(String(value)))
          .filter((pid): pid is number => pid !== undefined),
      ),
    ];
    if (shown.length === 0) {
      return redirect(`${back}?error=${encodeURIComponent(t('admin.categories.productOrder.error.nothing'))}`, 303);
    }
    const typed = new Map(
      products.map((p) => [p.id, parseRank(form.get(`rank-${p.public_id}`))] as const),
    );
    await saveProductOrder(env.DB, id, applyRanks(shown, typed));
    await purgeCacheTags([CACHE_TAG.catalog]);
    return redirect(`${back}?saved=1`, 303);
  }

  if (String(form.get('_action')) === 'clearProductOrder') {
    await clearProductOrder(env.DB, id);
    await purgeCacheTags([CACHE_TAG.catalog]);
    return redirect(`/admin/categories/${publicId}/products?cleared=1`, 303);
  }

  const fail = (msg: string) =>
    redirect(`/admin/categories/${publicId}/edit?error=${encodeURIComponent(msg)}`, 303);

  const parsed = parseCategoryForm(form);
  if ('error' in parsed) return fail(parsed.error);

  // The parent selector submits a cat_ public ID; resolve it once, here.
  let parentId: number | null = null;
  if (parsed.data.parentPublicId) {
    const parent = await getCategoryByPublicId(env.DB, parsed.data.parentPublicId);
    if (!parent) return fail(t('admin.categories.error.parentGone'));
    parentId = parent.id;
  }

  // Cycle guard: a category can't be its own ancestor.
  if (parentId != null) {
    const blocked = new Set(await descendantIds(env.DB, id));
    if (blocked.has(parentId)) {
      return fail(t('admin.categories.error.cycle'));
    }
  }

  const slug = await uniqueCategorySlug(env.DB, parsed.data.slugInput || parsed.data.name, id);
  await updateCategory(env.DB, id, {
    name: parsed.data.name,
    slug,
    parent_id: parentId,
    description: parsed.data.description,
    seo_title: parsed.data.seo_title,
    seo_description: parsed.data.seo_description,
  });
  // Unchanged keys are written again: the statement is the same guarded one
  // either way, and it is what refuses a file deleted since the form loaded.
  const imageSet = await setCategoryImage(env.DB, id, parsed.data.imageKey);
  await purgeCacheTags([CACHE_TAG.catalog]);
  if (!imageSet) return fail(t('admin.categories.error.imageGone'));
  return redirect('/admin/categories', 303);
};
