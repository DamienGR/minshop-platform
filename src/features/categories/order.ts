import { LOCALE } from '../i18n/locale.ts';

/**
 * The order of the categories (ticket #228, migration 0059). Pure, so the
 * storefront's lists (`childrenOf()`), the admin's (`buildTree()`) and the
 * writes that place a category all read ONE rule, and the suite pins it.
 *
 * A FAMILY is the categories sharing one parent; the top level is one. Within
 * a family, the position the merchant gave, then the name. A family nobody has
 * ranged is all 0, hence alphabetical, as before the migration. A move writes
 * the whole family 1, 2, 3…, so a ranged family is one with a position above 0,
 * and it stays recognisable when it shrinks to a single member.
 */
export interface Ranked {
  id: number;
  name: string;
  position: number;
}

export function compareCategories(
  a: Pick<Ranked, 'name' | 'position'>,
  b: Pick<Ranked, 'name' | 'position'>,
): number {
  return a.position - b.position || a.name.localeCompare(b.name, LOCALE);
}

/** True once the merchant has ranged this family. */
export function isRanged(family: readonly Pick<Ranked, 'position'>[]): boolean {
  return family.some((c) => c.position > 0);
}

/**
 * The family's ids in their new order once `id` moves one rank, or null when
 * it cannot (not in the family, already first or last). Sorted first, so the
 * neighbour is the one the merchant sees beside it. The caller writes the
 * WHOLE family from this list: in a family never ranged every position is 0,
 * and swapping two equal positions would move nothing.
 */
export function moveWithinFamily(
  family: readonly Ranked[],
  id: number,
  direction: 'up' | 'down',
): number[] | null {
  const ids = [...family].sort(compareCategories).map((c) => c.id);
  const from = ids.indexOf(id);
  if (from === -1) return null;
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= ids.length) return null;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}

/**
 * Where categories joining a family land, as id → position. A ranged family
 * takes them last, in their own order; one never ranged takes them at their
 * alphabetical place (0), so a shop that ranges nothing sees nothing change.
 * Into a family with nobody else in it, they are the family and keep their
 * order (1 to n if they were ranged).
 *
 * Used when a deleted category's children rise a level (`deleteCategory()`).
 * A single newcomer — created, or moved under another parent — takes the same
 * rule in SQL (`nextPositionSql()`), in the statement that writes it.
 */
export function arrivalPositions(
  family: readonly Ranked[],
  arriving: readonly Ranked[],
): Map<number, number> {
  const ordered = [...arriving].sort(compareCategories);
  let at: (rank: number) => number = () => 0;
  if (isRanged(family)) {
    const last = Math.max(...family.map((c) => c.position));
    at = (rank) => last + 1 + rank;
  } else if (family.length === 0 && isRanged(arriving)) {
    at = (rank) => rank + 1;
  }
  return new Map(ordered.map((c, rank) => [c.id, at(rank)]));
}
