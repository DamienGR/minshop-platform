import { fr } from './messages.ts';

/**
 * The storefront's string lookup.
 *
 * Pure — no bindings, no D1, no request context — so it is usable from unit
 * tests, from presentation models, and (via the storefront boundary check)
 * from store-owned templates. There is nothing to configure and nothing to
 * await: the store's locale is a build-time constant (see `locale.ts`), so
 * `t()` is an object read plus, at most, one placeholder pass.
 */

/** Every string the core can render. Adding a call site for a key that is not
 *  in `messages.ts` is a type error, not a blank space on the page. */
export type MessageKey = keyof typeof fr;

/** What a second locale must implement, in full. */
export type LocaleCatalog = Record<MessageKey, string>;

const CATALOG: LocaleCatalog = fr;

export type MessageParams = Record<string, string | number>;

/**
 * Look up a string, substituting `{nom}` placeholders.
 *
 * An unsubstituted placeholder is left in the output rather than blanked. It
 * reads as a bug on the page — which is what it is — where an empty string
 * reads as a sentence the translator meant to end there.
 */
export function t(key: MessageKey, params?: MessageParams): string {
  const message = CATALOG[key];
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

/**
 * Pick a form by count, then substitute — `{count}` included, so a caller never
 * has to pass the number twice.
 *
 * French pluralization, not English: ZERO takes the singular ("0 article"),
 * which is the rule the CLDR `one` category encodes for fr and the reason this
 * is not `count === 1`. Anything beyond one/other (Polish, Arabic) is a
 * `Intl.PluralRules` call away, and belongs here when a locale needs it — not
 * spread across call sites.
 */
export function tn(
  one: MessageKey,
  other: MessageKey,
  count: number,
  params?: MessageParams,
): string {
  const form = Math.abs(count) < 2 ? one : other;
  return t(form, { count, ...params });
}

export { LOCALE, LANG, DEFAULT_TIME_ZONE, DEFAULT_CURRENCY } from './locale.ts';
export { formatNumber, formatDateTime, NARROW_NBSP } from './format.ts';
