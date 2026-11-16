/**
 * The order the merchant gives the products of a category (ticket #239,
 * migration 0060). Pure: the admin's form and the suite read one rule.
 *
 * Admin → Catégories → « Ordre des produits » lists what the category page
 * shows, in its current order, each product with its rank in a number field.
 * The merchant changes the numbers of the products to move and saves; every
 * other product keeps its place relative to the rest. The whole list is then
 * written 1 to n, so the storefront reads a plain ascending position.
 */

/**
 * The « Par défaut » order of a category page (`categoryOrderClause()` in
 * products/sort.ts): the placed products by position, then the others newest
 * first — the Nouveautés order, so a category with no order at all reads
 * exactly as it did. `manual_position` is the column `productsInCategorySql()`
 * adds to its rows when the clause names it.
 */
export const MANUAL_ORDER = 'manual_position IS NULL, manual_position, created_at DESC, id DESC';

/**
 * A rank typed in the form: a whole number from 1, or null for anything else —
 * an empty field, a letter, 0, a decimal — which moves nothing.
 */
export function parseRank(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!/^\d{1,6}$/.test(text)) return null;
  const rank = Number(text);
  return rank >= 1 ? rank : null;
}

/**
 * The ids in their new order, from the list as shown and the ranks typed.
 *
 * A product whose number is its rank as shown, or no number at all, stays in
 * place relative to the others. A product given another number is lifted out
 * and put back at that rank once the others have closed up, so typing 1 on the
 * fortieth product makes it first and typing 3 on the first makes it third.
 * Several moves land in the order of their numbers; two products given the
 * same number keep their order between them. A number past the end puts the
 * product last.
 */
export function applyRanks(
  shown: readonly number[],
  typed: ReadonlyMap<number, number | null>,
): number[] {
  const moves: { id: number; rank: number; from: number }[] = [];
  const staying: number[] = [];
  shown.forEach((id, from) => {
    const rank = typed.get(id) ?? null;
    if (rank !== null && rank !== from + 1) moves.push({ id, rank, from });
    else staying.push(id);
  });
  // Ascending ranks, so a later insertion never shifts an earlier one; for an
  // equal rank, the later product first, so the earlier ends up ahead of it.
  moves.sort((a, b) => a.rank - b.rank || b.from - a.from);
  const order = staying;
  for (const move of moves) order.splice(Math.min(move.rank - 1, order.length), 0, move.id);
  return order;
}
