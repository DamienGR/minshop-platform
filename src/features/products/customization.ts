/**
 * Customisable products (ticket #125, ADR 0022): a product can ask the buyer for
 * free text — the name embroidered on a bag — through fields the merchant sets
 * on the product in the admin, each with a label, a help text and a maximum
 * length.
 *
 * Pure (no bindings), because every way into a sale reads the same rules: the
 * add-to-cart route, the cart cookie, Buy now through /express and /checkout,
 * and the JSON checkout. A rule written twice is a rule that disagrees with
 * itself on the day a buyer finds the gap.
 *
 * What a buyer types is THEIR text. It may name a person, so it never goes in
 * the line's name (which the erasure keeps as an accounting record): it rides
 * apart, on the reservation and then on the order line, where the erasure can
 * empty it (shopctl/src/privacy/map.mjs). It is never logged.
 */
import { t } from '../i18n/index.ts';
import { parsePublicId } from '../ids/publicId.ts';

/** A field as the merchant defined it (a `product_custom_fields` row). */
export interface ProductCustomField {
  id: number;
  public_id: string | null;
  product_id: number;
  label: string;
  help_text: string | null;
  max_length: number;
  /** 1 = the buyer must fill it in; 0 = they may leave it blank. */
  required: number;
  position: number;
}

/** One answer as an order line keeps it: the label as it read then, and the text. */
export interface CustomizationEntry {
  label: string;
  value: string;
}

/** What a buyer typed, keyed by the field's `cfld_` public ID. */
export type CustomValues = Record<string, string>;

/**
 * The merchant's ceiling on a field's maximum length. Every character a buyer
 * types travels in the cart cookie, which a browser drops past 4 KB — the add
 * route refuses a line that would not fit (cart.ts), and this keeps one line
 * well inside it.
 */
export const CUSTOM_FIELD_MAX_LENGTH = 200;
/** Fields a product may ask for. Past a handful, a product is a form. */
export const CUSTOM_FIELDS_PER_PRODUCT = 5;
export const CUSTOM_LABEL_MAX_LENGTH = 80;
export const CUSTOM_HELP_MAX_LENGTH = 200;

/** The form field a value is posted under: `custom:<cfld_…>`, beside `qty:<key>`. */
export const customFieldName = (publicId: string): string => `custom:${publicId}`;

/** Bidirectional controls: they can make an embroidery order read backwards. */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;
const CONTROL = /\p{Cc}/gu;

/**
 * The text as it is kept: NFC, no control character (a newline becomes a
 * space), no bidirectional override, inner runs of spaces collapsed, trimmed.
 * One line of text, because that is what the field on the product page is.
 */
export function normalizeCustomValue(raw: unknown): string {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(CONTROL, ' ')
    .replace(BIDI_CONTROLS, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Length as a buyer counts it: characters, not UTF-16 code units. */
export const customValueLength = (value: string): number => [...value].length;

export type CustomizationCheck =
  | { ok: true; values: CustomValues; entries: CustomizationEntry[] }
  | { ok: false; error: string };

/**
 * Judge what a buyer typed against the product's fields, in the fields' order.
 *
 * A required field left blank and a text over the field's maximum are refused,
 * never truncated: a name cut to fit is embroidered wrong. A value for a field
 * the product does not have (removed since, or invented) is dropped. The
 * returned `values` are the canonical ones — normalized, blanks left out — so
 * two identical answers make one cart line.
 */
export function checkCustomization(
  fields: readonly ProductCustomField[],
  submitted: CustomValues,
): CustomizationCheck {
  const values: CustomValues = {};
  const entries: CustomizationEntry[] = [];
  for (const field of fields) {
    if (!field.public_id) continue;
    const value = normalizeCustomValue(submitted[field.public_id]);
    if (value === '') {
      if (field.required) {
        return { ok: false, error: t('product.error.customRequired', { champ: field.label }) };
      }
      continue;
    }
    if (customValueLength(value) > field.max_length) {
      return {
        ok: false,
        error: t('product.error.customTooLong', { champ: field.label, max: field.max_length }),
      };
    }
    values[field.public_id] = value;
    entries.push({ label: field.label, value });
  }
  return { ok: true, values, entries };
}

/** The values a form posted for these fields (`custom:<cfld_…>`), raw. */
export function readCustomValues(
  fields: readonly ProductCustomField[],
  get: (name: string) => unknown,
): CustomValues {
  const out: CustomValues = {};
  for (const field of fields) {
    if (!field.public_id) continue;
    const raw = get(customFieldName(field.public_id));
    if (raw != null && raw !== '') out[field.public_id] = String(raw);
  }
  return out;
}

// ── The cart cookie's encoding ───────────────────────────────────────────────

/** Past this, a token is not a line anybody typed. */
const MAX_TOKEN_LENGTH = 4096;
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (token: string): Uint8Array | null => {
  try {
    const binary = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
};

/**
 * The values as one cart-key segment: base64url of the sorted `[id, text]`
 * pairs. base64url because the cookie's own encoding leaves it alone (a
 * percent-encoded accent would be encoded a second time), and sorted so the
 * same answers always make the same key. '' when there is nothing.
 */
export function encodeCustomValues(values: CustomValues): string {
  const pairs = Object.entries(values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (pairs.length === 0) return '';
  return toBase64Url(new TextEncoder().encode(JSON.stringify(pairs)));
}

/**
 * Read a segment back, or null if ANY of it is off: the cookie is the
 * shopper's to edit. Only the canonical form is accepted — re-encoding must
 * give the same token — so one set of answers can never hide behind two keys.
 * Whether the values fit the product's CURRENT fields is checkCustomization's
 * question, asked when the cart is resolved against D1.
 */
export function decodeCustomValues(token: string): CustomValues | null {
  if (!token || token.length > MAX_TOKEN_LENGTH || !TOKEN_RE.test(token)) return null;
  const bytes = fromBase64Url(token);
  if (!bytes) return null;
  let pairs: unknown;
  try {
    pairs = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!Array.isArray(pairs) || pairs.length === 0 || pairs.length > CUSTOM_FIELDS_PER_PRODUCT) return null;
  const values: CustomValues = {};
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [id, value] = pair as unknown[];
    if (typeof id !== 'string' || parsePublicId(id, 'customField') !== id) return null;
    if (typeof value !== 'string' || value === '' || normalizeCustomValue(value) !== value) return null;
    if (customValueLength(value) > CUSTOM_FIELD_MAX_LENGTH) return null;
    if (Object.hasOwn(values, id)) return null;
    values[id] = value;
  }
  return encodeCustomValues(values) === token ? values : null;
}

// ── What a line shows ────────────────────────────────────────────────────────

/** "Nom à broder : Damien" — the one wording, on every page and in every e-mail. */
export const customizationText = (entry: CustomizationEntry): string =>
  t('product.customization.entry', { champ: entry.label, texte: entry.value });

/**
 * The answers an order line or a reservation keeps, read back. Anything that
 * is not the shape this module writes reads as no answer at all: an erased
 * line is NULL, and a page must not fail on it.
 */
export function parseCustomization(raw: unknown): CustomizationEntry[] {
  if (raw == null || raw === '') return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) =>
    entry &&
    typeof entry === 'object' &&
    typeof (entry as CustomizationEntry).label === 'string' &&
    typeof (entry as CustomizationEntry).value === 'string'
      ? [{ label: (entry as CustomizationEntry).label, value: (entry as CustomizationEntry).value }]
      : [],
  );
}

/** As stored on the order line and the reservation: JSON, or null for none. */
export const serializeCustomization = (entries: readonly CustomizationEntry[] | null | undefined): string | null =>
  entries && entries.length > 0 ? JSON.stringify(entries.map(({ label, value }) => ({ label, value }))) : null;

/**
 * The personalisation column of a reservation (migration 0049): what each
 * line's buyer typed, in the order of its items, null for a line without any.
 * Kept out of the items JSON so that clearing it is one assignment: the items
 * stay as long as the reservation does, the buyer's text does not.
 */
export function customizationColumn(
  items: readonly { customization?: readonly CustomizationEntry[] | null }[],
): string | null {
  if (!items.some((item) => item.customization && item.customization.length > 0)) return null;
  return JSON.stringify(
    items.map((item) => (item.customization && item.customization.length > 0 ? item.customization : null)),
  );
}

/**
 * The items with that column put back, line by line. Written beside these
 * very items: a length that disagrees is not theirs, and no text is better
 * than another line's.
 */
export function withCustomization<T extends { customization?: CustomizationEntry[] | null }>(
  items: T[],
  column: string | null | undefined,
): T[] {
  if (!column) return items;
  let perLine: unknown;
  try {
    perLine = JSON.parse(column);
  } catch {
    return items;
  }
  if (!Array.isArray(perLine) || perLine.length !== items.length) return items;
  return items.map((item, index) => {
    const entries = parseCustomization(perLine[index]);
    return entries.length > 0 ? { ...item, customization: entries } : item;
  });
}

/**
 * One line for a payment page that shows a description under the item
 * (Stripe's): the answers joined, or undefined for a line without any. The
 * buyer reads back what they typed before paying for it.
 */
export const customizationSummary = (entries: readonly CustomizationEntry[] | null | undefined): string | undefined =>
  entries && entries.length > 0 ? entries.map(customizationText).join(' · ') : undefined;
