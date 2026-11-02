import { publicIdToken } from '../ids/publicId.ts';

/**
 * The bank transfer rail (ticket #146, ADR 0023): the shop shows the
 * merchant's bank details and a reference, the buyer transfers the money from
 * their own bank, and the merchant records the transfer in the admin once it
 * shows on their statement. Nothing here reaches a bank: reconciliation is a
 * person reading a statement.
 *
 * Pure, so the settings form, the storefront and the tests judge an IBAN the
 * same way, and the storefront shell can ask whether the rail is open without
 * loading anything.
 */

/** How long the stock stays held while the transfer travels, in days. The
 *  first shop's current site keeps an unpaid order eight days. */
export const BANK_TRANSFER_DEFAULT_DAYS = 8;
export const BANK_TRANSFER_MIN_DAYS = 1;
export const BANK_TRANSFER_MAX_DAYS = 30;

/** What a shop needs to take a transfer, as the settings hold it. */
export interface BankTransferSettings {
  bankTransferIban: string | null;
  bankTransferBic: string | null;
  bankTransferHolder: string | null;
  bankTransferDays: number;
}

/** The details a buyer copies into their bank's form. */
export interface BankTransferDetails {
  holder: string;
  iban: string;
  bic: string | null;
}

/** An IBAN as typed (spaces, lowercase) → its electronic form. */
export function normalizeIban(raw: string): string {
  return raw.replace(/[\s  -]/g, '').toUpperCase();
}

/**
 * ISO 13616: two letters, two check digits, then up to thirty alphanumerics,
 * and the whole, rotated and read as a number, leaves 1 modulo 97. Checked
 * here because a typo in the merchant's IBAN sends every buyer's money to a
 * bank that rejects it — days later, after the stock was held for nothing.
 */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rotated = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rotated) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** The printed form: groups of four, as a bank statement shows it. */
export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})(?=.)/g, '$1 ');
}

export function normalizeBic(raw: string): string {
  return raw.replace(/\s/g, '').toUpperCase();
}

/** ISO 9362: bank, country, location, and an optional branch. */
export function isValidBic(raw: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalizeBic(raw));
}

/** A stored delay, or the default; out of range falls back rather than throws. */
export function parseHoldDays(value: string | null | undefined): number {
  const days = Number(value);
  return Number.isInteger(days) && days >= BANK_TRANSFER_MIN_DAYS && days <= BANK_TRANSFER_MAX_DAYS
    ? days
    : BANK_TRANSFER_DEFAULT_DAYS;
}

/**
 * The details the shop shows, or null while the rail cannot take a transfer:
 * an account holder and an IBAN that passes its check. The BIC is optional —
 * a SEPA transfer has not needed one since 2016, though some banks still ask.
 */
export function bankTransferDetails(settings: BankTransferSettings): BankTransferDetails | null {
  const holder = settings.bankTransferHolder?.trim() ?? '';
  const iban = settings.bankTransferIban ?? '';
  if (!holder || !isValidIban(iban)) return null;
  const bic = settings.bankTransferBic ? normalizeBic(settings.bankTransferBic) : '';
  return { holder, iban: normalizeIban(iban), bic: bic || null };
}

/**
 * The reference the buyer writes in the transfer's label: the order's own
 * reference (the ten characters after `ord_`), in capitals. The same string
 * names the order on its page, in its e-mails and in the admin search, so the
 * merchant matches one line of a statement to one order. Crockford base32 has
 * no I, L, O or U to misread.
 */
export function transferReference(orderPublicId: string): string {
  return (publicIdToken(orderPublicId, 'order') ?? orderPublicId).toUpperCase();
}

/** The settlement key of a transfer: the pending row's, then the order's. */
export function bankTransferSessionId(orderPublicId: string): string {
  return `bank_transfer_${orderPublicId}`;
}

/** Days → seconds, for the stock hold. */
export function holdSeconds(days: number): number {
  return days * 24 * 60 * 60;
}
