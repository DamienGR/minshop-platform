/**
 * VAT contained in a tax-inclusive total.
 *
 * The French B2C market sells TTC — the manifest's `french-prices-include-tax`
 * rule refuses any other shape (plan §4) — so a price is not "amount plus tax":
 * the tax is already inside it. What the order has to record is the split, not
 * a surcharge. `orders.tax_cents` keeps its existing meaning (tax ADDED on top,
 * which is what Stripe Tax computes for exclusive pricing) and stays 0 here;
 * conflating the two would make every historical order's total ambiguous.
 *
 * Pure, so the same arithmetic is unit-tested and used at settlement. Rates are
 * BASIS POINTS (2000 = 20 %): France's reduced rates are 5.5 % and 2.1 %, and
 * an integer percent cannot hold either.
 */

/** Percent as written by a human (20, 5.5, 2.1) → basis points. */
export function vatRateBps(percent: number): number {
  return Math.round(percent * 100);
}

/**
 * The VAT inside a tax-inclusive amount: `ttc × rate / (1 + rate)`.
 *
 * Rounded half-up on the last cent, once, on the ORDER TOTAL rather than per
 * line. Summing per-line roundings drifts — three lines at 3,33 € each round to
 * 0,56 € of VAT apiece, 1,68 € in total, where the 9,99 € order actually
 * contains 1,67 €. The total is what the buyer paid and what the accounts read,
 * so it is what the split is taken from.
 */
export function vatIncludedCents(totalCents: number, rateBps: number): number {
  if (!Number.isFinite(totalCents) || !Number.isFinite(rateBps)) return 0;
  if (totalCents <= 0 || rateBps <= 0) return 0;
  return Math.round((totalCents * rateBps) / (10_000 + rateBps));
}

/** The tax-exclusive part of a tax-inclusive amount. Always sums back exactly. */
export function netOfVatCents(totalCents: number, rateBps: number): number {
  return totalCents - vatIncludedCents(totalCents, rateBps);
}

/**
 * The standard French rate, 20 %, in basis points: what a shop computes with
 * when its `src/store.config.ts` says nothing.
 *
 * Here, in a module with no imports, rather than as a literal in `config.ts`:
 * the manifest gate (`scripts/store-vat.mjs`) reads the shop's effective VAT
 * in plain Node, where `config.ts` cannot load, and a copy of the default
 * there would eventually disagree with this one.
 */
export const DEFAULT_VAT_RATE_BPS = 2000;

/**
 * Why a shop charges no VAT at all (ADR 0024).
 *
 * `franchise` is the « franchise en base » of art. 293 B du CGI: a seller under
 * the turnover thresholds — typically a micro-entreprise — neither charges nor
 * reclaims VAT, and every document standing in for an invoice says so. One
 * value, because the market is B2C France (ADR 0008): the other French
 * exemptions are for exports and B2B sales inside the EU, which the certified
 * scope does not sell.
 */
export type VatExemption = 'franchise';

export const VAT_EXEMPTIONS: readonly VatExemption[] = ['franchise'];

export function isVatExemption(value: unknown): value is VatExemption {
  return typeof value === 'string' && (VAT_EXEMPTIONS as readonly string[]).includes(value);
}

/**
 * What a checkout records about VAT: the rate in force, or the exemption.
 *
 * The two are exclusive. An exempt shop records a rate of 0 — « il n'y avait
 * pas de TVA », a fact — beside the exemption that explains it; a shop with
 * neither records null — « nous ne savons pas », which is not the same fact
 * (ADR 0010).
 */
export interface VatTerms {
  rateBps: number | null;
  exemption: VatExemption | null;
}

/** The terms a shop's configuration sells under. An exemption wins over any
 *  rate: a seller in franchise has no rate to apply, whatever the default. */
export function vatTerms(legal: { vatRateBps: number; vatExemption: VatExemption | null }): VatTerms {
  if (isVatExemption(legal.vatExemption)) return { rateBps: 0, exemption: legal.vatExemption };
  const rate = legal.vatRateBps;
  return { rateBps: Number.isFinite(rate) && rate > 0 ? rate : null, exemption: null };
}

/**
 * What an order records about its VAT, from the terms its reservation carried
 * and the total the buyer paid.
 *
 * An exemption records a rate and an amount of 0: the CSV export then reads
 * `0` where a shop with no recorded split reads an empty cell, and the
 * bookkeeper can tell the two apart (ticket #148).
 */
export function orderVat(
  totalCents: number,
  carried: { rateBps: number | null; exemption: string | null } | null,
): { rateBps: number | null; amountCents: number | null; exemption: VatExemption | null } {
  const exemption = carried?.exemption;
  if (isVatExemption(exemption)) return { rateBps: 0, amountCents: 0, exemption };
  const rate = carried?.rateBps ?? null;
  if (rate == null || !(rate > 0)) return { rateBps: null, amountCents: null, exemption: null };
  return { rateBps: rate, amountCents: vatIncludedCents(totalCents, rate), exemption: null };
}

/** The exemption a stored order was sold under, or null. A value this build
 *  does not know reads as none rather than as a mention it cannot print. */
export function orderVatExemption(order: { vat_exemption?: string | null }): VatExemption | null {
  return isVatExemption(order.vat_exemption) ? order.vat_exemption : null;
}
