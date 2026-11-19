import { describe, expect, it } from 'vitest';
import {
  discountAmount,
  discountLabel,
  discountStatus,
  generateDiscountCode,
  isWellFormedDiscountCode,
  judgeDiscount,
  normalizeDiscountCode,
  settlesNothingDue,
  type DiscountCode,
} from './code';

function code(overrides: Partial<DiscountCode> = {}): DiscountCode {
  return {
    id: 7,
    public_id: 'dsc_test',
    code: 'NOEL10',
    kind: 'percent',
    value: 10,
    min_subtotal_cents: 0,
    starts_on: null,
    ends_on: null,
    max_uses: null,
    active: 1,
    created_at: '2026-11-19 10:00:00',
    ...overrides,
  };
}

const ctx = { subtotalCents: 5000, today: '2026-12-01', uses: 0, currency: 'eur' };

describe('normalizeDiscountCode', () => {
  it('compares in capitals, with no space anywhere', () => {
    expect(normalizeDiscountCode('  noel 10 ')).toBe('NOEL10');
    expect(normalizeDiscountCode('abcd efgh\tjkmn')).toBe('ABCDEFGHJKMN');
  });

  it('reads a full-width digit typed on a phone as a digit', () => {
    expect(normalizeDiscountCode('ＮＯＥＬ１０')).toBe('NOEL10');
  });

  it('is empty for nothing, or for anything but text', () => {
    expect(normalizeDiscountCode('')).toBe('');
    expect(normalizeDiscountCode('   ')).toBe('');
    expect(normalizeDiscountCode(null)).toBe('');
    expect(normalizeDiscountCode(42)).toBe('');
  });

  it('keeps one character past the limit, so an over-long code is refused rather than cut', () => {
    const long = normalizeDiscountCode('A'.repeat(200));
    expect(long).toHaveLength(33);
    expect(isWellFormedDiscountCode(long)).toBe(false);
  });
});

describe('isWellFormedDiscountCode', () => {
  it('takes letters, digits, dashes and underscores, 3 to 32 of them', () => {
    expect(isWellFormedDiscountCode('NOEL10')).toBe(true);
    expect(isWellFormedDiscountCode('ABCD-EFGH-JKMN')).toBe(true);
    expect(isWellFormedDiscountCode('ETE_2027')).toBe(true);
    expect(isWellFormedDiscountCode('A'.repeat(32))).toBe(true);
  });

  it('refuses a code too short, too long, or with anything else', () => {
    expect(isWellFormedDiscountCode('AB')).toBe(false);
    expect(isWellFormedDiscountCode('A'.repeat(33))).toBe(false);
    expect(isWellFormedDiscountCode('NOËL')).toBe(false);
    expect(isWellFormedDiscountCode('-NOEL')).toBe(false);
    expect(isWellFormedDiscountCode('NOEL-')).toBe(false);
    expect(isWellFormedDiscountCode('NO<EL')).toBe(false);
  });
});

describe('discountAmount', () => {
  it('takes a percentage of the items, rounded to the cent', () => {
    expect(discountAmount({ kind: 'percent', value: 10 }, 5000)).toBe(500);
    expect(discountAmount({ kind: 'percent', value: 15 }, 1999)).toBe(300);
  });

  it('takes a fixed amount, never more than the items cost', () => {
    expect(discountAmount({ kind: 'amount', value: 1500 }, 5000)).toBe(1500);
    expect(discountAmount({ kind: 'amount', value: 5000 }, 1200)).toBe(1200);
    expect(discountAmount({ kind: 'percent', value: 100 }, 1200)).toBe(1200);
  });

  it('takes nothing off an empty basket', () => {
    expect(discountAmount({ kind: 'amount', value: 1500 }, 0)).toBe(0);
  });
});

describe('judgeDiscount', () => {
  it('accepts a code and says what it takes off', () => {
    expect(judgeDiscount(code(), ctx)).toEqual({
      ok: true,
      discount: { id: 7, code: 'NOEL10', amountCents: 500 },
    });
  });

  it('says the same thing of an unknown, a switched-off, a not-yet-open and a used-up code', () => {
    const unknown = judgeDiscount(null, ctx);
    const cases = [
      judgeDiscount(code({ active: 0 }), ctx),
      judgeDiscount(code({ starts_on: '2026-12-02' }), ctx),
      judgeDiscount(code({ max_uses: 1 }), { ...ctx, uses: 1 }),
    ];
    expect(unknown).toMatchObject({ ok: false, reason: 'unknown', message: 'Ce code n’est pas valable.' });
    expect(cases.map((c) => (c.ok ? null : c.reason))).toEqual(['inactive', 'notYet', 'exhausted']);
    for (const c of cases) expect(c.ok ? null : c.message).toBe('Ce code n’est pas valable.');
  });

  it('counts the first and the last day in', () => {
    expect(judgeDiscount(code({ starts_on: '2026-12-01', ends_on: '2026-12-01' }), ctx).ok).toBe(true);
  });

  it('says a code past its last day is no longer valid', () => {
    expect(judgeDiscount(code({ ends_on: '2026-11-30' }), ctx)).toMatchObject({
      ok: false,
      reason: 'expired',
      message: 'Ce code n’est plus valable.',
    });
  });

  it('names the minimum the basket has to reach', () => {
    const judged = judgeDiscount(code({ min_subtotal_cents: 6000 }), ctx);
    expect(judged).toMatchObject({ ok: false, reason: 'minimum' });
    expect(judged.ok ? '' : judged.message).toBe('Ce code s’applique dès 60,00 € d’articles.');
    expect(judgeDiscount(code({ min_subtotal_cents: 5000 }), ctx).ok).toBe(true);
  });

  it('accepts a limited code under its limit', () => {
    expect(judgeDiscount(code({ max_uses: 3 }), { ...ctx, uses: 2 }).ok).toBe(true);
  });
});

describe('discountStatus', () => {
  const today = '2026-12-01';
  it('reads « Désactivé » first, whatever the dates', () => {
    expect(discountStatus(code({ active: 0, ends_on: '2026-01-01' }), today, 0)).toBe('off');
  });

  it('reads expired, used up, not yet open, or switched on', () => {
    expect(discountStatus(code({ ends_on: '2026-11-30' }), today, 0)).toBe('expired');
    expect(discountStatus(code({ max_uses: 1 }), today, 1)).toBe('exhausted');
    expect(discountStatus(code({ starts_on: '2026-12-24' }), today, 0)).toBe('upcoming');
    expect(discountStatus(code({ max_uses: 2 }), today, 1)).toBe('active');
  });
});

describe('generateDiscountCode', () => {
  it('draws three groups of four, in Crockford’s capitals', () => {
    const drawn = generateDiscountCode();
    expect(drawn).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(isWellFormedDiscountCode(drawn)).toBe(true);
    expect(normalizeDiscountCode(drawn)).toBe(drawn);
  });

  it('reads five bits of each byte', () => {
    const bytes = (length: number) => Uint8Array.from({ length }, (_, i) => i * 33);
    // 0, 33, 66… masked to 0, 1, 2…: the alphabet's first twelve signs.
    expect(generateDiscountCode(bytes)).toBe('0123-4567-89AB');
  });

  it('does not draw the same code twice in a thousand', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateDiscountCode()));
    expect(seen.size).toBe(1000);
  });
});

describe('discountLabel', () => {
  it('names the code on the receipt line, when there is one', () => {
    expect(discountLabel('NOEL10')).toBe('Remise (NOEL10)');
    expect(discountLabel(null)).toBe('Remise');
  });
});

describe('settlesNothingDue', () => {
  it('lets only the card and the demo take an order the code pays in full', () => {
    expect(['stripe', 'demo', 'lightning', 'opennode', 'bank_transfer'].filter(settlesNothingDue)).toEqual([
      'stripe',
      'demo',
    ]);
  });
});

