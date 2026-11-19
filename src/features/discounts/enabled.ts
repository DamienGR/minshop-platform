import type { D1Database } from '@cloudflare/workers-types';
import { getConfig } from '../../config';
import type { StoreSettings } from '../settings/db';
import { hasActiveDiscountCode } from './db';

/**
 * Whether the shop takes discount codes (ADR 0033): Admin → Réglages →
 * « Codes promo », over `discounts.enabled` in store.config.ts. Off, no field
 * is drawn and a posted code is ignored — the JSON checkout refuses one.
 */
export function discountsOn(settings: Pick<StoreSettings, 'discountsEnabled'> | null | undefined): boolean {
  return settings?.discountsEnabled ?? getConfig().discounts.enabled;
}

/**
 * Whether a page draws the field: the shop takes codes, and there is one to
 * type — a code the buyer already carries, or any code switched on. A shop
 * that has none shows no empty field, which would only send its buyers
 * looking for codes elsewhere; its first code brings the field. A code the
 * buyer carries keeps it, refusal and « Retirer le code » included.
 */
export async function discountFieldShown(
  db: D1Database,
  settings: Pick<StoreSettings, 'discountsEnabled'> | null | undefined,
  carried: string,
): Promise<boolean> {
  if (!discountsOn(settings)) return false;
  return carried !== '' || (await hasActiveDiscountCode(db));
}
