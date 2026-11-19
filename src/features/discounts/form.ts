import { toMinorUnits } from '../../money.ts';
import { t } from '../i18n/index.ts';
import {
  generateDiscountCode,
  isWellFormedDiscountCode,
  normalizeDiscountCode,
  type DiscountKind,
} from './code.ts';
import type { DiscountCodeFields } from './db.ts';

/**
 * The Admin → Codes promo form (ADR 0033), parsed and judged. Pure.
 *
 * Amounts arrive in major units (« 12,50 »), a comma or a point; percentages
 * as whole numbers. An empty code is generated: three groups of four that
 * nobody guesses, which is what a gift card needs.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function str(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}

/** A major-unit amount → minor units, or null when the field is empty, NaN when it is not a number. */
function amount(raw: string, currency: string): number | null {
  if (raw === '') return null;
  const major = Number(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(major) && major >= 0 ? toMinorUnits(major, currency) : Number.NaN;
}

function day(raw: string): string | null | undefined {
  if (raw === '') return null;
  if (!DAY.test(raw)) return undefined;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? undefined : raw;
}

export function parseDiscountForm(
  form: FormData,
  currency: string,
  generate: () => string = generateDiscountCode,
): { data: DiscountCodeFields } | { error: string } {
  const typed = normalizeDiscountCode(str(form, 'code'));
  const code = typed || generate();
  if (!isWellFormedDiscountCode(code)) return { error: t('admin.discounts.error.code') };

  const kind = str(form, 'kind') as DiscountKind;
  if (kind !== 'percent' && kind !== 'amount') return { error: t('admin.discounts.error.kind') };

  // One field, read by the unit chosen beside it: « 10 » and « % », or « 20 » and « € ».
  let value: number;
  if (kind === 'percent') {
    value = Number(str(form, 'value').replace(',', '.'));
    if (!Number.isInteger(value) || value < 1 || value > 100) return { error: t('admin.discounts.error.percent') };
  } else {
    const cents = amount(str(form, 'value'), currency);
    if (cents == null || Number.isNaN(cents) || cents < 1) return { error: t('admin.discounts.error.amount') };
    value = cents;
  }

  const minimum = amount(str(form, 'min_subtotal'), currency);
  if (minimum != null && Number.isNaN(minimum)) return { error: t('admin.discounts.error.minimum') };

  const startsOn = day(str(form, 'starts_on'));
  const endsOn = day(str(form, 'ends_on'));
  if (startsOn === undefined || endsOn === undefined) return { error: t('admin.discounts.error.date') };
  if (startsOn && endsOn && endsOn < startsOn) return { error: t('admin.discounts.error.dates') };

  const usesRaw = str(form, 'max_uses');
  let maxUses: number | null = null;
  if (usesRaw !== '') {
    maxUses = Number(usesRaw);
    if (!Number.isInteger(maxUses) || maxUses < 1) return { error: t('admin.discounts.error.maxUses') };
  }

  return {
    data: {
      code,
      kind,
      value,
      min_subtotal_cents: minimum ?? 0,
      starts_on: startsOn,
      ends_on: endsOn,
      max_uses: maxUses,
      // Unchecked checkboxes submit nothing: absence means switched off.
      active: form.get('active') != null ? 1 : 0,
    },
  };
}
