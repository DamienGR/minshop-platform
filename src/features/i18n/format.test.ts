import { describe, expect, it } from 'vitest';
import { formatMoney } from '../../money';
import { formatDateTime, formatNumber, NARROW_NBSP } from './format';
import { LANG, LOCALE } from './locale';

/**
 * French formatting, asserted on CODE POINTS rather than on what the string
 * looks like.
 *
 * `1 234,56 €` contains two characters a copy-paste turns into ordinary spaces:
 * U+202F between the thousands and U+00A0 before the currency sign. Both are
 * invisible in a diff and both change how the line wraps, so every assertion
 * here spells them out. A test written with plain spaces passes on the day
 * someone breaks this and fails on the day ICU gets it right.
 */
describe('French number and money formatting', () => {
  it('formats a price as 1 234,56 €', () => {
    expect(formatMoney(123_456, 'eur')).toBe('1\u202f234,56\u00a0€');
  });

  it('puts the currency sign last, decimal comma included', () => {
    expect(formatMoney(999, 'eur')).toBe('9,99\u00a0€');
    expect(formatMoney(0, 'eur')).toBe('0,00\u00a0€');
  });

  it('groups thousands with a narrow no-break space, never a comma', () => {
    const formatted = formatMoney(1_000_000_00, 'eur');

    expect(formatted).toContain(NARROW_NBSP);
    expect(formatted).not.toContain(',000');
    expect(formatted).toBe('1\u202f000\u202f000,00\u00a0€');
  });

  it('keeps a currency with no minor unit whole', () => {
    // The scale comes from ISO 4217 data, not from a hardcoded 100 — a shop
    // reading back an order charged in yen must not gain two decimals.
    expect(formatMoney(1000, 'jpy')).toBe('1\u202f000\u00a0JPY');
  });

  it('formats a bare number the same way', () => {
    expect(formatNumber(1234.5)).toBe('1\u202f234,5');
    expect(formatNumber(0.2, { style: 'percent' })).toBe('20\u00a0%');
  });
});

describe('French dates', () => {
  // 09:05 UTC is 10:05 in Paris in January — the offset is the point of the
  // assertion, so a store that lost its time zone reads an hour early.
  const instant = new Date('2026-01-15T09:05:00Z');

  it('reads day-month-year in Europe/Paris', () => {
    expect(formatDateTime(instant, { dateStyle: 'long' }, 'Europe/Paris')).toBe('15 janvier 2026');
  });

  it('formats a timestamp with a 24-hour clock', () => {
    expect(
      formatDateTime(instant, { dateStyle: 'short', timeStyle: 'short' }, 'Europe/Paris'),
    ).toBe('15/01/2026 10:05');
  });

  it('falls back to UTC instead of throwing on an unusable zone', () => {
    // The zone can arrive from a deployment var or an admin setting. A bad one
    // must not be able to break an order confirmation page.
    expect(formatDateTime(instant, { dateStyle: 'short' }, 'Mars/Olympus')).toBe('15/01/2026');
  });
});

describe('locale constants', () => {
  it('derives the html lang attribute from the locale, not from a second fact', () => {
    expect(LOCALE).toBe('fr-FR');
    expect(LANG).toBe('fr');
  });
});
