import { describe, expect, it } from 'vitest';
import { applyRanks, parseRank } from './productOrder';

const ranks = (entries: [number, number | null][]) => new Map(entries);

describe('parseRank (ticket #239)', () => {
  it('reads a whole number from 1, spaces around it allowed', () => {
    expect(parseRank('1')).toBe(1);
    expect(parseRank(' 12 ')).toBe(12);
  });

  it('reads anything else as no move', () => {
    for (const raw of ['', ' ', '0', '-1', '2.5', '1e3', 'deux', '١', '1234567', null, undefined, 3]) {
      expect(parseRank(raw), String(raw)).toBeNull();
    }
  });
});

describe('applyRanks (ticket #239)', () => {
  const shown = [1, 2, 3, 4, 5];

  it('leaves the list as it is when no number changes', () => {
    expect(applyRanks(shown, ranks([]))).toEqual(shown);
    expect(applyRanks(shown, ranks([[1, 1], [2, 2], [3, null]]))).toEqual(shown);
  });

  it('puts a product at the rank typed, moving up or down', () => {
    expect(applyRanks(shown, ranks([[5, 1]]))).toEqual([5, 1, 2, 3, 4]);
    expect(applyRanks(shown, ranks([[1, 3]]))).toEqual([2, 3, 1, 4, 5]);
    expect(applyRanks(shown, ranks([[4, 2]]))).toEqual([1, 4, 2, 3, 5]);
  });

  it('puts a product last for a number past the end', () => {
    expect(applyRanks(shown, ranks([[2, 99]]))).toEqual([1, 3, 4, 5, 2]);
  });

  it('lands several moves at their numbers', () => {
    // The first and the last swap places.
    expect(applyRanks(shown, ranks([[1, 5], [5, 1]]))).toEqual([5, 2, 3, 4, 1]);
    // Two neighbours swap.
    expect(applyRanks(shown, ranks([[1, 2], [2, 1]]))).toEqual([2, 1, 3, 4, 5]);
    // The whole list reversed, number by number.
    expect(applyRanks(shown, ranks(shown.map((id) => [id, 6 - id])))).toEqual([5, 4, 3, 2, 1]);
  });

  it('keeps the order shown between two products given the same number', () => {
    expect(applyRanks(shown, ranks([[3, 1], [4, 1]]))).toEqual([3, 4, 1, 2, 5]);
    expect(applyRanks(shown, ranks([[4, 1], [3, 1]]))).toEqual([3, 4, 1, 2, 5]);
  });

  it('returns every id once, whatever was typed', () => {
    const typed = ranks([[1, 4], [2, 4], [3, 1], [4, 99], [5, 2]]);
    const order = applyRanks(shown, typed);
    expect([...order].sort()).toEqual(shown);
  });

  it('handles an empty list', () => {
    expect(applyRanks([], ranks([]))).toEqual([]);
  });
});
