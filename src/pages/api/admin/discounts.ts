import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig } from '../../../config';
import { createDiscountCode, isCodeTaken } from '../../../features/discounts/db';
import { parseDiscountForm } from '../../../features/discounts/form';
import { t } from '../../../features/i18n';

export const prerender = false;

// POST /api/admin/discounts — create a code (ADR 0033), then back to the list.
// A refusal goes back to the form it came from, the gift card's included.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const back = (msg: string) =>
    `/admin/discounts/new?${form.get('preset') === 'gift' ? 'preset=gift&' : ''}error=${encodeURIComponent(msg)}`;
  const parsed = parseDiscountForm(form, getConfig().currency);
  if ('error' in parsed) return redirect(back(parsed.error), 303);
  try {
    const publicId = await createDiscountCode(env.DB, parsed.data);
    return redirect(`/admin/discounts?saved=1#${publicId}`, 303);
  } catch (err) {
    if (isCodeTaken(err)) return redirect(back(t('admin.discounts.error.codeTaken')), 303);
    throw err;
  }
};
