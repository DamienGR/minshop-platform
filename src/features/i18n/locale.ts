/**
 * The store's locale, as three constants and nothing else.
 *
 * A leaf module ON PURPOSE: `money.ts` documents itself as import-free so that
 * pure, unit-tested code can use it without dragging in the Cloudflare runtime,
 * and it needs the locale to format a price. Anything with a dependency would
 * have cost that property. Nothing here imports, so nothing here can.
 *
 * One locale, not a list. `client.locale` in the manifest is an enum with a
 * single value, and widening it is a schema-version decision with migration
 * notes (plan §4) — the difference between a supported market and an untested
 * one. The catalog in `messages.ts` is typed so that a second locale is a file
 * the compiler checks, not a rewrite of every call site.
 */

/** BCP 47 tag passed to every `Intl` constructor. */
export const LOCALE = 'fr-FR';

/** What goes in `<html lang>`. The language subtag of LOCALE, not a second fact. */
export const LANG = LOCALE.split('-')[0];

/**
 * Business time zone. `TIME_ZONE` (wrangler var) and the admin settings overlay
 * both still win; this is what a shop gets when neither says otherwise, and
 * `client.timezone` in the manifest is the enum that agrees with it.
 */
export const DEFAULT_TIME_ZONE = 'Europe/Paris';

/** Store-wide currency (ISO 4217, lowercase — Stripe's form). */
export const DEFAULT_CURRENCY = 'eur';
