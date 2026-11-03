import type { Product } from './db';

/**
 * The variants a product card shows — a swatch per fabric, "5 tissus", the
 * photo that follows the swatch (ticket #161).
 *
 * Read IN the listing statement, never after it. A listing page is one D1 call
 * (features/storefront/reads.ts says why: every call costs CPU of its own), and
 * the variants cannot be a second statement in that batch, because a batch
 * cannot feed the page's ids to the next statement. A per-card read is out of
 * the question: D1 bills the rows it scans.
 *
 * So the listing is wrapped. Its own SQL becomes a subquery — `page` — and a
 * correlated subquery aggregates each row's active variants into one JSON
 * column. Measured on Miniflare with 500 products and 1 000 variants
 * (2026-11-03, `meta.rows_read`): the newest-first page of 24 reads 24 rows
 * bare and 95 wrapped; a price-sorted page, which already sorts the whole
 * table, 1 000 bare and 1 072 wrapped. The variants cost what they are, about
 * three rows per card, whatever the sort. The alternatives measured worse: the
 * subquery written in the listing's own column list is evaluated for every row
 * the sort sees (2 499), and a second statement re-running the listing to find
 * its ids scans the table twice (1 096).
 */

/** One active variant as a card needs it, decoded from `card_variants`. */
export interface CardVariantRow {
  id: number;
  label: string;
  price_cents: number;
  stock: number;
  position: number;
  /** The variant's own gallery image, when it names one of its product's. */
  image_key: string | null;
  image_alt: string | null;
}

/** A product row as the storefront lists it: the row and, as JSON, its active
 *  variants. NULL from a query that did not ask for them. */
export type ListedProduct = Product & { card_variants: string | null };

/**
 * Each row's active variants, as a JSON array of arrays. The image join is
 * held to the variant's OWN product's gallery: a variant can only point at an
 * image of its product (migration 0018), and a stale id must not borrow
 * another product's photo. Order is restored in JS, by position then id —
 * SQLite does not promise the order an aggregate sees its rows in.
 */
const CARD_VARIANTS_COLUMN = `(
  SELECT json_group_array(json_array(v.id, v.label, v.price_cents, v.stock, v.position, pi.image_key, pi.alt))
    FROM product_variants v
    LEFT JOIN product_images pi ON pi.id = v.image_id AND pi.product_id = v.product_id
   WHERE v.product_id = page.id AND v.active = 1
)`;

/**
 * A product listing, each row carrying its active variants.
 *
 * `listing` selects whole product rows (`SELECT *`, `SELECT DISTINCT p.*`) and
 * keeps its own ORDER BY and LIMIT, so the page is cut BEFORE the variants are
 * read. `order` is the same clause, repeated outside: a subquery's order does
 * not survive the query around it. Both come from code — a clause of
 * features/products/sort.ts, never request input. The listing's bound
 * parameters keep their positions.
 */
export function withCardVariants(listing: string, order?: string): string {
  return `SELECT page.*, ${CARD_VARIANTS_COLUMN} AS card_variants FROM (${listing}) AS page${
    order ? ` ORDER BY ${order}` : ''
  }`;
}

/**
 * The same column for rows that arrived without it — search results, whose
 * providers each write their own query. One statement for the whole page,
 * binding the ids once: `SELECT id, card_variants` for `count` ids.
 */
export function cardVariantsForIdsSql(count: number): string {
  const placeholders = Array.from({ length: count }, () => '?').join(', ');
  return `SELECT page.id AS id, ${CARD_VARIANTS_COLUMN} AS card_variants
    FROM (SELECT id FROM products WHERE id IN (${placeholders})) AS page`;
}

const isInteger = (value: unknown): value is number => Number.isInteger(value);

/**
 * Decode the column. Tolerant by design: a NULL (a query that did not ask), a
 * malformed value, or an entry of the wrong shape yields fewer variants, never
 * an exception on a public page — the card then reads as a product without.
 */
export function parseCardVariants(raw: string | null | undefined): CardVariantRow[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows: CardVariantRow[] = [];
  for (const entry of parsed) {
    if (!Array.isArray(entry)) continue;
    const [id, label, price, stock, position, imageKey, imageAlt] = entry as unknown[];
    if (!isInteger(id) || typeof label !== 'string' || !isInteger(price) || !isInteger(stock)) continue;
    rows.push({
      id,
      label,
      price_cents: price,
      stock,
      position: isInteger(position) ? position : 0,
      image_key: typeof imageKey === 'string' && imageKey ? imageKey : null,
      image_alt: typeof imageAlt === 'string' && imageAlt.trim() ? imageAlt : null,
    });
  }
  return rows.sort((a, b) => a.position - b.position || a.id - b.id);
}
