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
