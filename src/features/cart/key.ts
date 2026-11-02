/**
 * Cart-line keys + line pricing. A line is a product, optionally a chosen variant,
 * and a set of selected extras — so two of the same product with different
 * variant/extras are distinct lines. Pure (no bindings) so it's unit-testable and
 * shared by the cookie parser, the add-to-cart route, and checkout.
 *
 * Key format (prefixed public IDs only):  product[:variant][#extra,extra,…][~text]
 *   "prod_x"                     product, no variant, no extras
 *   "prod_x:var_y"               product + variant
 *   "prod_x#xtra_a,xtra_b"       product + extras (no variant)
 *   "prod_x:var_y#xtra_a,xtra_b" product + variant + extras
 *   "prod_x~WyJjZmxk…"           product + what the buyer typed in its
 *                                personalisation fields (customization.ts)
 * Extras are de-duped + sorted so the same selection always yields the same key.
 * The personalisation rides IN the key, so a bag embroidered "Léa" and one
 * embroidered "Tom" are two lines, and the same name twice is one line of two.
 * `~` is outside the public-ID and base64url alphabets, so it never splits a
 * part. Legacy numeric keys are NOT parsed — they fail validation and the line
 * drops.
 */
import { parsePublicId } from '../ids/publicId.ts';
import {
  decodeCustomValues,
  encodeCustomValues,
  type CustomValues,
} from '../products/customization.ts';

export interface ParsedKey {
  productPublicId: string;
  variantPublicId: string | null;
  extraPublicIds: string[];
  /** What the buyer typed, by `cfld_` ID; empty when the line has none. */
  customValues: CustomValues;
}

/** Canonical extras list: valid xtra_ IDs only, de-duped, sorted lexicographically. */
const canonicalExtras = (xs: string[]): string[] =>
  [...new Set(xs.map((x) => parsePublicId(x, 'extra')).filter((x): x is string => x !== null))].sort();

/** Build the canonical cart key for a product + optional variant + extras. */
export function cartKey(
  productPublicId: string,
  variantPublicId?: string | null,
  extraPublicIds: string[] = [],
  customValues: CustomValues = {},
): string {
  let key = productPublicId;
  if (variantPublicId) key += `:${variantPublicId}`;
  const ex = canonicalExtras(extraPublicIds);
  if (ex.length) key += `#${ex.join(',')}`;
  const text = encodeCustomValues(customValues);
  if (text) key += `~${text}`;
  return key;
}

/** Parse a cart key back to its parts, or null if ANY part is malformed (never trust cookies). */
export function parseCartKey(key: string): ParsedKey | null {
  const [selection, textPart, overflow] = key.split('~');
  if (overflow !== undefined) return null; // more than one '~' → malformed
  let customValues: CustomValues = {};
  if (textPart !== undefined) {
    const decoded = decodeCustomValues(textPart);
    if (!decoded) return null; // bare '~' or a token that is not canonical
    customValues = decoded;
  }
  const [left, extrasPart, spill] = selection.split('#');
  if (spill !== undefined) return null; // more than one '#' → malformed
  const [pidStr, vidStr, extra] = left.split(':');
  if (extra !== undefined) return null; // more than one ':' → malformed

  const productPublicId = parsePublicId(pidStr, 'product');
  if (!productPublicId) return null;

  let variantPublicId: string | null = null;
  if (vidStr !== undefined) {
    variantPublicId = parsePublicId(vidStr, 'variant');
    if (!variantPublicId) return null;
  }

  let extraPublicIds: string[] = [];
  if (extrasPart !== undefined) {
    const parts = extrasPart.split(',');
    extraPublicIds = canonicalExtras(parts);
    if (extraPublicIds.length !== new Set(parts).size) return null; // any invalid extra → reject
    if (extraPublicIds.length === 0) return null; // bare '#' → malformed
  }
  return { productPublicId, variantPublicId, extraPublicIds, customValues };
}

/**
 * Unit price for a line: the chosen variant's price (or the product base when
 * there's no variant) plus the sum of selected extra deltas.
 */
export function lineUnitPriceCents(
  baseCents: number,
  variant: { price_cents: number } | null,
  extras: { price_delta_cents: number }[],
): number {
  const base = variant ? variant.price_cents : baseCents;
  return base + extras.reduce((sum, e) => sum + e.price_delta_cents, 0);
}
