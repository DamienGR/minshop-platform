import type { AstroCookies } from 'astro';
import { DISCOUNT_CODE_MAX_LENGTH, normalizeDiscountCode } from './code.ts';

/**
 * The code a buyer applied in the cart (ADR 0033), kept between pages so the
 * cart and Buy now show it until it is removed.
 *
 * Only the text. What it is worth is judged again on every page against the
 * basket of the moment and the row of the moment: a cookie says what was
 * TYPED, never what it grants. httpOnly, like the cart: a gift card's code
 * is money, and no script of the page needs it.
 */
const COOKIE = 'discount';

export function readAppliedCode(cookies: AstroCookies): string {
  const code = normalizeDiscountCode(cookies.get(COOKIE)?.value ?? '');
  return code.length <= DISCOUNT_CODE_MAX_LENGTH ? code : '';
}

export function writeAppliedCode(cookies: AstroCookies, code: string, secure: boolean): void {
  if (!code) {
    cookies.delete(COOKIE, { path: '/' });
    return;
  }
  cookies.set(COOKIE, code, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    // A visit, not a season: a code left in a browser for a week is one a
    // second person on that computer finds already applied.
    maxAge: 60 * 60 * 24,
  });
}
