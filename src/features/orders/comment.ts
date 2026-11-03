/**
 * The buyer's comment on an order (ticket #162, ADR 0028): a free message left
 * before paying, when the merchant has switched it on — a delivery detail, a
 * gift message, the first name an artisan embroiders.
 *
 * Pure (no bindings), because every way into a sale reads the same rule: the
 * cart and Buy now forms through /api/checkout, every step of /checkout, and
 * the JSON checkout.
 *
 * It is the BUYER's text and may name somebody: it rides the reservation in a
 * column of its own, then the order, where the erasure empties it
 * (shopctl/src/privacy/map.mjs). It is never in a URL and never logged; a
 * refusal names the limit, never what was typed.
 */
import { t } from '../i18n/index.ts';

/** The form field and the JSON key it is posted under. */
export const ORDER_COMMENT_FIELD = 'order_comment';

/**
 * Characters, not UTF-16 units. A gift message or a delivery detail is a few
 * lines; past this, a comment is a letter, and a letter has no place in the
 * merchant's order e-mail.
 */
export const ORDER_COMMENT_MAX_LENGTH = 500;

/** Line breaks the buyer typed are kept; past two in a row, they are a gap. */
const MAX_BLANK_LINES = /\n{3,}/g;
/** Bidirectional controls: they can make a delivery detail read backwards. */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;
/** Every control character but the line feed. */
const CONTROL_BUT_NEWLINE = /[^\S\n]|\p{Cc}/gu;

/**
 * The comment as it is kept: NFC, line endings as `\n`, no other control
 * character (a tab becomes a space), no bidirectional override, each line's
 * runs of spaces collapsed and its ends trimmed, no more than one blank line
 * in a row, trimmed. Null when nothing is left.
 */
export function normalizeOrderComment(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(BIDI_CONTROLS, '')
    .replace(CONTROL_BUT_NEWLINE, (char) => (char === '\n' ? char : ' '))
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trim())
    .join('\n')
    .replace(MAX_BLANK_LINES, '\n\n')
    .trim();
  return text === '' ? null : text;
}

/** Length as a buyer counts it: characters, not UTF-16 code units. */
export const orderCommentLength = (value: string): number => [...value].length;

export type OrderCommentCheck = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Judge what the buyer typed. Too long is refused, never truncated: a message
 * cut at 500 characters loses its end, which is where a gift message signs.
 * A shop that does not take comments reads none, whatever was posted.
 */
export function checkOrderComment(raw: unknown, enabled: boolean): OrderCommentCheck {
  if (!enabled) return { ok: true, value: null };
  const value = normalizeOrderComment(raw);
  if (value !== null && orderCommentLength(value) > ORDER_COMMENT_MAX_LENGTH) {
    return { ok: false, error: t('checkout.comment.tooLong', { max: ORDER_COMMENT_MAX_LENGTH }) };
  }
  return { ok: true, value };
}
