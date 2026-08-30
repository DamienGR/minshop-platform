import { LOCALE, DEFAULT_TIME_ZONE } from './locale.ts';

/**
 * Locale-aware number and date formatting.
 *
 * Money is NOT here: it lives in `money.ts`, which owns the minor-unit scaling
 * and is import-free so pure code can use it. Splitting the two would give the
 * store two places that decide how a price reads.
 *
 * Pure and binding-free. `config.formatDate` wraps `formatDateTime` to add the
 * store's configured time zone, which is the part that reads deployment vars.
 */

/**
 * U+202F NARROW NO-BREAK SPACE — French typography's thousands separator and
 * the space before `? ! ; :`. Exported because tests assert on it and a plain
 * space is indistinguishable by eye while wrapping differently.
 */
export const NARROW_NBSP = ' ';

// `Intl` constructors are expensive; a catalog page formats dozens of values.
const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function cached<T>(cache: Map<string, T>, key: string, build: () => T): T {
  let value = cache.get(key);
  if (!value) {
    value = build();
    cache.set(key, value);
  }
  return value;
}

/** A plain number in French: `1 234,5` (narrow no-break space, decimal comma). */
export function formatNumber(value: number, opts: Intl.NumberFormatOptions = {}): string {
  const formatter = cached(numberFormatters, JSON.stringify(opts), () =>
    new Intl.NumberFormat(LOCALE, opts),
  );
  return formatter.format(value);
}

/**
 * Format a `Date` in the store's locale and a given time zone.
 *
 * An unsupported zone falls back to UTC rather than throwing: the zone can come
 * from a deployment var or an admin setting, and a bad one must not be able to
 * break an order confirmation page.
 */
export function formatDateTime(
  date: Date,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const build = (zone: string) =>
    cached(dateFormatters, `${zone}|${JSON.stringify(opts)}`, () =>
      new Intl.DateTimeFormat(LOCALE, { timeZone: zone, ...opts }),
    );
  try {
    return build(timeZone).format(date);
  } catch {
    return build('UTC').format(date);
  }
}
