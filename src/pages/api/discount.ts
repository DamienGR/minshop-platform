import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig } from '../../config';
import { applySubmittedQuantities, readCart, resolveCart, writeCart } from '../../features/cart/cart';
import { DISCOUNT_CODE_FIELD } from '../../features/discounts/code.ts';
import { writeAppliedCode } from '../../features/discounts/cookie.ts';
import { checkDiscountCode } from '../../features/discounts/db.ts';
import { discountsOn } from '../../features/discounts/enabled';
import { getStoreSettings } from '../../features/settings/db';

export const prerender = false;

/**
 * POST /api/discount — the cart's « Appliquer » and « Retirer le code »
 * (ADR 0033). The button posts the cart's own form here, so the quantities
 * typed go with it and are kept, as « Mettre à jour » keeps them.
 *
 * A code accepted is remembered in a cookie (features/discounts/cookie.ts)
 * and judged again on every page; a refused one comes back as the cart's
 * error, which never repeats the code — a gift card's code is money, and
 * URLs are logged. Rate-limited with the checkout (features/auth/rateLimit.ts),
 * like every form that judges a code; what protects a gift card from guessing
 * is its generated code, sixty bits that no rate of requests gets through
 * (ADR 0033).
 */
export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  const settings = await getStoreSettings(env.DB);
  if (!settings.cartEnabled) return redirect('/', 303);
  const form = await request.formData();
  const secure = url.protocol === 'https:';

  const cart = readCart(cookies);
  if (applySubmittedQuantities(cart, form)) writeCart(cookies, cart, secure);

  if (!discountsOn(settings) || form.get('_action') === 'remove') {
    writeAppliedCode(cookies, '', secure);
    return redirect('/cart', 303);
  }

  const { subtotalCents } = await resolveCart(env.DB, cart);
  const judged = await checkDiscountCode(env.DB, form.get(DISCOUNT_CODE_FIELD), {
    subtotalCents,
    currency: getConfig().currency,
    timeZone: settings.timeZone ?? getConfig().timeZone,
  });
  // The refusal's wording, never the code: it names a minimum at most.
  if (judged && !judged.ok) return redirect(`/cart?error=${encodeURIComponent(judged.message)}`, 303);
  writeAppliedCode(cookies, judged?.discount.code ?? '', secure);
  return redirect('/cart', 303);
};
