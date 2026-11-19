/**
 * Discount codes typed in the cart (plan §13.32, ADR 0033): the rule a code is
 * judged by, and what it takes off.
 *
 * Pure (no bindings), because every way into a sale reads the same rule: the
 * cart, Buy now (/express), every step of /checkout, the JSON checkout, and
 * the admin form that creates one. The rows come from `./db.ts`.
 *
 * A code takes its amount off the ITEMS, never the delivery, and never more
 * than the items cost. The socle computes it, whatever the payment: Stripe
 * receives the amount as a one-off coupon, the other rails charge the total
 * net of it. The free-delivery thresholds stay judged on the items before the
 * code (ADR 0033).
 */
import { t } from '../i18n/index.ts';
import { formatMoney } from '../../money.ts';

/** The form field (cart, Buy now, /checkout) and the JSON key it is posted under. */
export const DISCOUNT_CODE_FIELD = 'discount_code';

/** Long enough for a generated gift card (14 with its dashes), short enough to type. */
export const DISCOUNT_CODE_MAX_LENGTH = 32;
export const DISCOUNT_CODE_MIN_LENGTH = 3;

export type DiscountKind = 'percent' | 'amount';

/** A row of `discount_codes` (migration 0065). */
export interface DiscountCode {
  id: number;
  public_id: string;
  /** In capitals, as the cart compares it. */
  code: string;
  kind: DiscountKind;
  /** A percentage from 1 to 100, or an amount in minor units. */
  value: number;
  /** The items' total, before the code, the basket must reach. 0 = none. */
  min_subtotal_cents: number;
  /** The first and last day it holds, 'YYYY-MM-DD' in the shop's calendar. */
  starts_on: string | null;
  ends_on: string | null;
  /** Orders that may use it, null for no limit. A gift card says 1. */
  max_uses: number | null;
  active: number;
  created_at: string;
}

/** What a checkout carries once a code is accepted: onto the reservation, then the order. */
export interface AppliedDiscount {
  id: number;
  /** As stored: what the order, the e-mails and Stripe's page print. */
  code: string;
  /** Taken off the items, in minor units; never more than they cost. */
  amountCents: number;
}

const WELL_FORMED = /^[A-Z0-9](?:[A-Z0-9_-]*[A-Z0-9])?$/;

/**
 * The code as the cart compares it: NFKC (a full-width digit typed on a phone
 * is a digit), capitals, no space anywhere — a gift card read off paper is
 * typed in groups. '' when nothing was typed.
 */
export function normalizeDiscountCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').replace(/\s+/g, '').toUpperCase().slice(0, DISCOUNT_CODE_MAX_LENGTH + 1);
}

/** Letters, digits, `-` and `_`, starting and ending on a letter or a digit. */
export function isWellFormedDiscountCode(code: string): boolean {
  return (
    code.length >= DISCOUNT_CODE_MIN_LENGTH &&
    code.length <= DISCOUNT_CODE_MAX_LENGTH &&
    WELL_FORMED.test(code)
  );
}

/** What the code takes off items worth `subtotalCents`: rounded to the cent, capped at them. */
export function discountAmount(code: Pick<DiscountCode, 'kind' | 'value'>, subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  const raw = code.kind === 'percent' ? Math.round((subtotalCents * code.value) / 100) : code.value;
  return Math.max(0, Math.min(raw, subtotalCents));
}

export type DiscountRefusal = 'unknown' | 'inactive' | 'notYet' | 'expired' | 'minimum' | 'exhausted';

export type DiscountJudgement =
  | { ok: true; discount: AppliedDiscount }
  | { ok: false; reason: DiscountRefusal; message: string };

export interface DiscountContext {
  /** The items' total before the code. */
  subtotalCents: number;
  /** Today in the shop's calendar, 'YYYY-MM-DD' (`calendarDate()`). */
  today: string;
  /** Orders that carry the code plus checkouts still holding it. */
  uses: number;
  currency: string;
}

/**
 * Judge a code for one basket. The refusal names what the buyer can act on
 * — the minimum to reach, a code past its last day — and never says more:
 * an unknown, a switched-off, a not-yet-open and a used-up gift card read
 * the same to whoever is guessing.
 */
export function judgeDiscount(code: DiscountCode | null, ctx: DiscountContext): DiscountJudgement {
  const refuse = (reason: DiscountRefusal, message: string): DiscountJudgement => ({ ok: false, reason, message });
  if (!code || code.active !== 1) return refuse(code ? 'inactive' : 'unknown', t('discount.error.unknown'));
  if (code.starts_on && ctx.today < code.starts_on) return refuse('notYet', t('discount.error.unknown'));
  if (code.ends_on && ctx.today > code.ends_on) return refuse('expired', t('discount.error.expired'));
  if (code.max_uses != null && ctx.uses >= code.max_uses) return refuse('exhausted', t('discount.error.unknown'));
  if (ctx.subtotalCents < code.min_subtotal_cents) {
    return refuse(
      'minimum',
      t('discount.error.minimum', { montant: formatMoney(code.min_subtotal_cents, ctx.currency) }),
    );
  }
  return {
    ok: true,
    discount: { id: code.id, code: code.code, amountCents: discountAmount(code, ctx.subtotalCents) },
  };
}

export type DiscountStatus = 'active' | 'off' | 'upcoming' | 'expired' | 'exhausted';

/**
 * Where a code stands today, as Admin → Codes promo lists it: the first of
 * these that holds, so a code switched off reads « Désactivé » whatever its
 * dates. `uses` counts what `judgeDiscount()` counts.
 */
export function discountStatus(
  code: Pick<DiscountCode, 'active' | 'starts_on' | 'ends_on' | 'max_uses'>,
  today: string,
  uses: number,
): DiscountStatus {
  if (code.active !== 1) return 'off';
  if (code.ends_on && today > code.ends_on) return 'expired';
  if (code.max_uses != null && uses >= code.max_uses) return 'exhausted';
  if (code.starts_on && today < code.starts_on) return 'upcoming';
  return 'active';
}

/** Crockford's capitals: no I, L, O or U to misread on a printed card. */
const GIFT_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A code nobody guesses: three groups of four (60 bits), for a gift card or a
 * one-off code. A guessable gift card is money anyone can try for.
 */
export function generateDiscountCode(
  random: (length: number) => Uint8Array = (length) => crypto.getRandomValues(new Uint8Array(length)),
): string {
  const bytes = random(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) out += '-';
    // 256 is a multiple of 32: masking a byte to five bits stays uniform.
    out += GIFT_ALPHABET[(bytes[i] ?? 0) & 0x1f];
  }
  return out;
}

/** The label a receipt line reads, « Remise (NOEL10) », or « Remise » without a code. */
export function discountLabel(code: string | null | undefined): string {
  return code ? t('discount.label.withCode', { code }) : t('discount.label');
}

/**
 * Whether a rail can settle an order a code pays in full. Stripe completes a
 * session of 0 without a payment (`no_payment_required`) and the demo takes
 * anything; a Lightning invoice of 0 sat, a transfer of 0 € or an OpenNode
 * charge of nothing cannot be paid, so those rails refuse such a basket.
 */
export function settlesNothingDue(method: string): boolean {
  return method === 'stripe' || method === 'demo';
}
