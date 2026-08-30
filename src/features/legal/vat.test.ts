import { describe, expect, it } from 'vitest';
import { netOfVatCents, vatIncludedCents, vatRateBps } from './vat';

const NORMAL = vatRateBps(20);
const REDUCED = vatRateBps(5.5);
const SUPER_REDUCED = vatRateBps(2.1);

describe('French VAT rates', () => {
  it('holds the rates an integer percent cannot', () => {
    // 5,5 % and 2,1 % are ordinary French rates. A rate stored as an integer
    // percent silently becomes 5 % and 2 %, which is a pricing bug that only
    // shows up in the accounts.
    expect(vatRateBps(20)).toBe(2000);
    expect(vatRateBps(5.5)).toBe(550);
    expect(vatRateBps(2.1)).toBe(210);
  });
});

describe('VAT inside a tax-inclusive total', () => {
  it('splits a round total at the standard rate', () => {
    // 120,00 € TTC at 20 % = 100,00 € HT + 20,00 € de TVA.
    expect(vatIncludedCents(12_000, NORMAL)).toBe(2000);
    expect(netOfVatCents(12_000, NORMAL)).toBe(10_000);
  });

  it('rounds the last cent half-up', () => {
    // 9,99 € TTC contains 1,665 € — one cent has to go somewhere.
    expect(vatIncludedCents(999, NORMAL)).toBe(167);
  });

  it('takes the rounding on the total, not per line', () => {
    // Three lines of 3,33 € round to 56 c each — 1,68 € — where the 9,99 €
    // order really contains 1,67 €. The drift is why this takes the total.
    const perLine = 3 * vatIncludedCents(333, NORMAL);

    expect(perLine).toBe(168);
    expect(vatIncludedCents(999, NORMAL)).toBe(167);
  });

  it('always sums back to the amount charged', () => {
    for (const total of [1, 99, 100, 999, 1234, 99_999, 1_000_000]) {
      for (const rate of [NORMAL, REDUCED, SUPER_REDUCED]) {
        expect(vatIncludedCents(total, rate) + netOfVatCents(total, rate)).toBe(total);
      }
    }
  });

  it('applies the reduced rates', () => {
    // 105,50 € TTC à 5,5 % = 100,00 € HT.
    expect(vatIncludedCents(10_550, REDUCED)).toBe(550);
    expect(vatIncludedCents(10_210, SUPER_REDUCED)).toBe(210);
  });

  it('reports nothing rather than a negative split', () => {
    // A zero-rated shop, a free order, or a refund line must not invent VAT.
    expect(vatIncludedCents(0, NORMAL)).toBe(0);
    expect(vatIncludedCents(1000, 0)).toBe(0);
    expect(vatIncludedCents(-1000, NORMAL)).toBe(0);
    expect(vatIncludedCents(Number.NaN, NORMAL)).toBe(0);
  });
});
