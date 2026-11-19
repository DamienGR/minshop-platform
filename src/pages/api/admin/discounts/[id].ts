import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig } from '../../../../config';
import {
  deleteUnusedDiscountCode,
  getDiscountCodeByPublicId,
  isCodeTaken,
  setDiscountCodeActive,
  updateDiscountCode,
} from '../../../../features/discounts/db';
import { parseDiscountForm } from '../../../../features/discounts/form';
import { parsePublicId } from '../../../../features/ids/publicId';
import { t } from '../../../../features/i18n';

export const prerender = false;

// POST /api/admin/discounts/:id — save the form, switch the code on or off
// when `_action=toggle`, or delete it when `_action=delete` (ADR 0033).
// :id is the dsc_ public ID; numeric row ids are not accepted.
export const POST: APIRoute = async ({ request, params, redirect }) => {
  const publicId = parsePublicId(params.id, 'discountCode');
  const code = publicId ? await getDiscountCodeByPublicId(env.DB, publicId) : null;
  if (!code) return new Response(t('admin.discounts.notFound'), { status: 404 });

  const form = await request.formData();
  const action = String(form.get('_action') ?? '');

  if (action === 'toggle') {
    await setDiscountCodeActive(env.DB, code.id, code.active !== 1);
    return redirect(`/admin/discounts?saved=1#${publicId}`, 303);
  }

  if (action === 'delete') {
    // A code an order or a checkout carries stays, switched off: the order
    // keeps its text, and the statement that deletes checks in one step.
    if (await deleteUnusedDiscountCode(env.DB, code.id)) return redirect('/admin/discounts?deleted=1', 303);
    await setDiscountCodeActive(env.DB, code.id, false);
    return redirect(`/admin/discounts?kept=1#${publicId}`, 303);
  }

  const back = (msg: string) => `/admin/discounts/${publicId}/edit?error=${encodeURIComponent(msg)}`;
  // An emptied code field keeps the code it had: a new one is drawn only on creation.
  const parsed = parseDiscountForm(form, getConfig().currency, () => code.code);
  if ('error' in parsed) return redirect(back(parsed.error), 303);
  try {
    await updateDiscountCode(env.DB, code.id, parsed.data);
  } catch (err) {
    if (isCodeTaken(err)) return redirect(back(t('admin.discounts.error.codeTaken')), 303);
    throw err;
  }
  return redirect(`/admin/discounts?saved=1#${publicId}`, 303);
};
