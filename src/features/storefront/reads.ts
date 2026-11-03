import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import {
  ancestorsStatement,
  categoriesForProductStatement,
  countProductsInCategoryStatement,
  listCategoriesStatement,
  productsInCategorySql,
  RELATED_PRODUCTS_SQL,
  type Category,
} from '../categories/db';
import {
  countProductsStatement,
  listProductImagesStatement,
  listProductsSql,
  type ProductImageRow,
} from '../products/db';
import { cardVariantsForIdsSql, withCardVariants, type ListedProduct } from '../products/cardVariants';
import {
  listExtrasStatement,
  listVariantsStatement,
  type ProductExtra,
  type ProductVariant,
} from '../products/variants';
import { listCustomFieldsStatement } from '../products/customFields';
import type { ProductCustomField } from '../products/customization';

/**
 * The storefront's page reads, one `db.batch()` each.
 *
 * CPU, not latency, is why. On the Workers Free plan a request has 10 ms of
 * CPU, and every D1 call spends some of it in the isolate — the statement
 * serialised, the binding's fetch, its trace span, the rows parsed back. The
 * certification measured it (étape 6, the built Worker under V8's profiler):
 * a product page made seven D1 calls, and those calls were about 60 % of its
 * warm CPU; sent as one batch, the page fell from 13 to 8 ms. A batch is one
 * call whatever it holds, and its statements run in order in one transaction —
 * harmless for reads.
 *
 * What a batch cannot do is feed one statement's answer to the next. So the
 * row a page is ABOUT (the product, the category) stays its own read, and a
 * listing fetches the page that was ASKED for: when `?page=` is past the end,
 * the loader clamps and reads the last page again — the one case that costs
 * a second call.
 */

const rows = <T>(result: D1Result | undefined): T[] => (result?.results ?? []) as T[];
const count = (result: D1Result | undefined): number =>
  ((result?.results?.[0] as { n?: number } | undefined)?.n ?? 0);

export interface ProductPageRows {
  categories: Category[];
  variants: ProductVariant[];
  extras: ProductExtra[];
  /** The free-text fields the buyer fills in (ticket #125). */
  customFields: ProductCustomField[];
  images: ProductImageRow[];
  /** Active products sharing a category, newest first, up to `relatedLimit`,
   *  each with its card variants. */
  related: ListedProduct[];
}

/** Everything a product page reads once its product is known. */
export async function readProductPageRows(
  db: D1Database,
  productId: number,
  relatedLimit: number,
): Promise<ProductPageRows> {
  const [categories, variants, extras, customFields, images, related] = await db.batch([
    categoriesForProductStatement(db, productId),
    listVariantsStatement(db, productId),
    listExtrasStatement(db, productId),
    listCustomFieldsStatement(db, productId),
    listProductImagesStatement(db, productId),
    db.prepare(withCardVariants(RELATED_PRODUCTS_SQL, 'created_at DESC')).bind(productId, relatedLimit),
  ]);
  return {
    categories: rows<Category>(categories),
    variants: rows<ProductVariant>(variants),
    extras: rows<ProductExtra>(extras),
    customFields: rows<ProductCustomField>(customFields),
    images: rows<ProductImageRow>(images),
    related: rows<ListedProduct>(related),
  };
}

export interface ListingQuery {
  pageSize: number;
  offset: number;
  /** A clause from features/products/sort.ts — never request input. */
  order: string;
}

/** One page of the catalogue as cards read it — the variants included. */
export function catalogPageStatement(
  db: D1Database,
  { pageSize, offset, order }: ListingQuery,
): D1PreparedStatement {
  return db.prepare(withCardVariants(listProductsSql(order), order)).bind(pageSize, offset);
}

/** A product row in stock: through its active variants when it has any —
 *  the variant is the unit sold — else through its own count. */
const IN_STOCK = `CASE
    WHEN EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = products.id AND v.active = 1)
    THEN EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = products.id AND v.active = 1 AND v.stock > 0)
    ELSE products.stock > 0
  END`;

/**
 * The product the catalog puts forward (ticket #164), as one statement of the
 * catalog batch: the merchant's choice while it is active; else the newest
 * product in stock; else the newest. Three arms in that order and one row:
 * SQLite stops at the first that answers, so a chosen product costs one
 * lookup, and the fallback walks the newest-first index only as far as the
 * first product it can sell — an empty or sold-out catalogue is the one case
 * that reads it all.
 *
 * Product 0 does not exist, so a shop that chose nothing binds 0.
 */
export function featuredProductStatement(db: D1Database, chosenId: number | null): D1PreparedStatement {
  const newest = 'ORDER BY created_at DESC, id DESC LIMIT 1';
  const candidates = `SELECT * FROM (
      SELECT * FROM products WHERE id = ?1 AND active = 1
      UNION ALL
      SELECT * FROM (SELECT * FROM products WHERE active = 1 AND ${IN_STOCK} ${newest})
      UNION ALL
      SELECT * FROM (SELECT * FROM products WHERE active = 1 ${newest})
    ) LIMIT 1`;
  return db.prepare(withCardVariants(candidates)).bind(chosenId ?? 0);
}

export interface CatalogRows {
  total: number;
  categories: Category[];
  products: ListedProduct[];
  /** The product put forward, or null for an empty catalogue. */
  featured: ListedProduct | null;
}

/** The catalogue: its size, the category list, one page of products, and the
 *  product it puts forward. */
export async function readCatalogRows(
  db: D1Database,
  query: ListingQuery & { featuredProductId?: number | null },
): Promise<CatalogRows> {
  const [total, categories, products, featured] = await db.batch([
    countProductsStatement(db),
    listCategoriesStatement(db),
    catalogPageStatement(db, query),
    featuredProductStatement(db, query.featuredProductId ?? null),
  ]);
  return {
    total: count(total),
    categories: rows<Category>(categories),
    products: rows<ListedProduct>(products),
    featured: rows<ListedProduct>(featured)[0] ?? null,
  };
}

/** One page of a category as cards read it — the variants included. */
export function categoryPageStatement(
  db: D1Database,
  categoryId: number,
  { pageSize, offset, order }: ListingQuery,
): D1PreparedStatement {
  return db
    .prepare(withCardVariants(productsInCategorySql(order), order))
    .bind(categoryId, pageSize, offset);
}

/**
 * Card variants for products a search provider found, keyed by product id —
 * one statement for the whole page. Providers write their own queries (FTS5,
 * Vectorize), so their rows cannot carry the column; this is the one listing
 * that pays a second call, and only when it has results.
 */
export async function readCardVariants(
  db: D1Database,
  productIds: number[],
): Promise<Map<number, string | null>> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Map();
  const { results } = await db
    .prepare(cardVariantsForIdsSql(ids.length))
    .bind(...ids)
    .all<{ id: number; card_variants: string | null }>();
  return new Map((results ?? []).map((row) => [row.id, row.card_variants]));
}

/** A category page: its trail, the category list, its size, one page of products. */
export async function readCategoryRows(
  db: D1Database,
  categoryId: number,
  { pageSize, offset, order }: ListingQuery,
): Promise<{ trail: Category[]; categories: Category[]; total: number; products: ListedProduct[] }> {
  const [trail, categories, total, products] = await db.batch([
    ancestorsStatement(db, categoryId),
    listCategoriesStatement(db),
    countProductsInCategoryStatement(db, categoryId),
    categoryPageStatement(db, categoryId, { pageSize, offset, order }),
  ]);
  return {
    trail: rows<Category>(trail),
    categories: rows<Category>(categories),
    total: count(total),
    products: rows<ListedProduct>(products),
  };
}
