import { describe, expect, it } from 'vitest';
import { stripeLocale } from './stripe';
import { LANG } from '../i18n/locale';

/**
 * The hosted Stripe page is the one screen of the purchase the store does not
 * render, so it is the one that can silently go back to English without any
 * page of this repository changing.
 */
describe('the hosted checkout locale', () => {
  it('follows the store locale, not the browser', () => {
    // 'auto' is Stripe's default and means "whatever the browser asks for" — a
    // French shop's copy, prices and legal text around an English payment form.
    expect(stripeLocale(LANG)).toBe('fr');
    expect(stripeLocale(LANG)).not.toBe('auto');
  });

  it('falls back to Stripe detection for a language it cannot render', () => {
    // An English payment page beats no payment page: an unknown locale must not
    // fail session creation.
    expect(stripeLocale('xx')).toBe('auto');
  });
});
