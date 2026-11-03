import { describe, expect, it } from 'vitest';
import {
  ORDER_COMMENT_MAX_LENGTH,
  checkOrderComment,
  normalizeOrderComment,
  orderCommentLength,
} from './comment';

describe('normalizeOrderComment', () => {
  it('keeps the buyer’s line breaks, as \\n', () => {
    expect(normalizeOrderComment('Bonjour,\r\nPrénom : Léa\rMerci')).toBe('Bonjour,\nPrénom : Léa\nMerci');
  });

  it('trims each line, collapses its spaces, and keeps at most one blank line', () => {
    expect(normalizeOrderComment('  Un   cadeau \t pour   Inès  \n\n\n\n  Merci  ')).toBe(
      'Un cadeau pour Inès\n\nMerci',
    );
  });

  it('drops control characters and bidirectional overrides', () => {
    expect(normalizeOrderComment('Lé\u0000a \u202Eabc\u202C')).toBe('Lé a abc');
  });

  it('composes accents (NFC), so a length is the one the buyer sees', () => {
    const composed = normalizeOrderComment('Le\u0301a');
    expect(composed).toBe('Léa');
    expect(orderCommentLength(composed!)).toBe(3);
  });

  it('reads nothing from a blank or a non-string', () => {
    expect(normalizeOrderComment('  \n \t ')).toBeNull();
    expect(normalizeOrderComment(undefined)).toBeNull();
    expect(normalizeOrderComment(42)).toBeNull();
  });
});

describe('checkOrderComment', () => {
  it('takes a comment up to the limit, counted in characters', () => {
    const atLimit = '😀'.repeat(ORDER_COMMENT_MAX_LENGTH);
    expect(checkOrderComment(atLimit, true)).toEqual({ ok: true, value: atLimit });
  });

  it('refuses one past it, without quoting it', () => {
    const tooLong = `Léa${'x'.repeat(ORDER_COMMENT_MAX_LENGTH)}`;
    const check = checkOrderComment(tooLong, true);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.error).toContain(String(ORDER_COMMENT_MAX_LENGTH));
    expect(check.error).not.toContain('Léa');
  });

  it('reads no comment at all where the shop takes none', () => {
    expect(checkOrderComment('Prénom : Léa', false)).toEqual({ ok: true, value: null });
    expect(checkOrderComment('x'.repeat(ORDER_COMMENT_MAX_LENGTH + 1), false)).toEqual({ ok: true, value: null });
  });
});
