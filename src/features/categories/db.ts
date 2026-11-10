import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { Product } from '../products/db';
import { withPublicId } from '../ids/publicId.ts';
import { arrivalPositions, compareCategories, moveWithinFamily, type Ranked } from './order.ts';

export interface Category {
  id: number;
  name: string;
  slug: string;
  parent_id: number | null;
  public_id: string | null;
  /** A media item's key, shown by themes that present the category (migration
   *  0052). A USE of the file, never its owner: invariant 10. NULL = none. */
  image_key: string | null;
  /** A short plain-text presentation, at most 300 characters. NULL = none. */
  description: string | null;
  /** What a search engine shows of the category page (migration 0057,
   *  features/seo/fields.ts); null = derived. */
  seo_title: string | null;
  seo_description: string | null;
  /** Its rank among its siblings (migration 0059, `order.ts`); 0 = never
   *  ranged, which sorts by name. */
  position: number;
  created_at: string;
}

export interface CategoryNode extends Category {
  depth: number;
  children: CategoryNode[];
}

/** A depth-tagged flat row, for indented <select> options / checkboxes. */
export interface CategoryOption {
  id: number;
  public_id: string | null;
  name: string;
  slug: string;
  depth: number;
  /** First or last of its family: where Admin → Catégories offers no ↑ or ↓. */
  first: boolean;
  last: boolean;
}

export interface CategoryFields {
  name: string;
  slug: string;
  parent_id: number | null;
  description: string | null;
  seo_title: string | null;
  seo_description: string | null;
}

/**
 * The `…Statement` builders below are the same reads as their async twins,
 * unexecuted, so a storefront page can send them in ONE `db.batch()`
 * (features/storefront/reads.ts). On Workers every D1 call costs CPU of its
 * own — serialising, the binding's fetch, its trace span — and a product page
 * made seven of them: batched, its warm CPU fell by about 40 % (certification,
 * étape 6). The twins call the builders, so each query is still written once.
 */
export function listCategoriesStatement(db: D1Database): D1PreparedStatement {
  // The families are sorted again by `childrenOf()` and `buildTree()`, with
  // the locale's collation; this keeps a flat reader (sitemap, llms.txt) close.
  return db.prepare('SELECT * FROM categories ORDER BY position, name');
}

export async function listCategories(db: D1Database): Promise<Category[]> {
  const { results } = await listCategoriesStatement(db).all<Category>();
  return results ?? [];
}

export async function getCategory(db: D1Database, id: number): Promise<Category | null> {
  return db.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first<Category>();
}

export async function getCategoryBySlug(db: D1Database, slug: string): Promise<Category | null> {
  return db.prepare('SELECT * FROM categories WHERE slug = ?').bind(slug).first<Category>();
}

/** Category by its prefixed public ID (boundary resolution; null if missing). */
export async function getCategoryByPublicId(
  db: D1Database,
  publicId: string,
): Promise<Category | null> {
  return db.prepare('SELECT * FROM categories WHERE public_id = ?').bind(publicId).first<Category>();
}

/** Categories for many public IDs in one boundary-resolution read. */
export async function getCategoriesByPublicIds(
  db: D1Database,
  publicIds: string[],
): Promise<Category[]> {
  if (publicIds.length === 0) return [];
  const placeholders = publicIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT * FROM categories WHERE public_id IN (${placeholders})`)
    .bind(...publicIds)
    .all<Category>();
  return results ?? [];
}

/**
 * The position of a category joining the family under the parameter `parent`
 * (`?n`): after the last if the family has been ranged, 0 — its alphabetical
 * place — if not (`arrivalPositions()` in `order.ts`, for one newcomer). A
 * subquery of the statement that writes the row, so two writes cannot both
 * read the same last position. `exclude` leaves the moving row itself out.
 */
function nextPositionSql(parent: string, exclude?: string): string {
  return `(SELECT CASE WHEN MAX(s.position) > 0 THEN MAX(s.position) + 1 ELSE 0 END
             FROM categories s
            WHERE s.parent_id IS ${parent}${exclude ? ` AND s.id != ${exclude}` : ''})`;
}

export async function createCategory(db: D1Database, c: CategoryFields): Promise<number> {
  return withPublicId('category', async (publicId) => {
    const row = await db
      .prepare(
        `INSERT INTO categories (name, slug, parent_id, description, seo_title, seo_description, public_id, position)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ${nextPositionSql('?3')}) RETURNING id`,
      )
      .bind(c.name, c.slug, c.parent_id, c.description, c.seo_title, c.seo_description, publicId)
      .first<{ id: number }>();
    return row!.id;
  });
}

/** Saves the form. A category moved under another parent joins that family by
 *  the rule of a new one; one that stays keeps its position. SQLite evaluates
 *  every SET from the row as it was, so `parent_id` there is the old parent. */
export async function updateCategory(db: D1Database, id: number, c: CategoryFields): Promise<void> {
  await db
    .prepare(
      `UPDATE categories
          SET name = ?1, slug = ?2, description = ?4, seo_title = ?5, seo_description = ?6,
              position = CASE WHEN parent_id IS ?3 THEN position ELSE ${nextPositionSql('?3', '?7')} END,
              parent_id = ?3
        WHERE id = ?7`,
    )
    .bind(c.name, c.slug, c.parent_id, c.description, c.seo_title, c.seo_description, id)
    .run();
}

/**
 * Write positions into one family, one CASE statement per chunk, as
 * `reorderMenuItems()` does: 30 rows cost 61 bound parameters against D1's
 * 100. Positions are interpolated, never bound: integers this module
 * computed, checked here. Scoped by parent, so a row moved to another family
 * meanwhile is left alone.
 */
function positionStatements(
  db: D1Database,
  parentId: number | null,
  positions: ReadonlyMap<number, number>,
): D1PreparedStatement[] {
  const entries = [...positions];
  const CHUNK = 30;
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = entries.slice(i, i + CHUNK);
    const cases = chunk
      .map(([, position]) => {
        if (!Number.isSafeInteger(position) || position < 0) throw new Error(`bad position ${position}`);
        return `WHEN ? THEN ${position}`;
      })
      .join(' ');
    const ids = chunk.map(([id]) => id);
    statements.push(
      db
        .prepare(
          `UPDATE categories SET position = CASE id ${cases} ELSE position END
            WHERE parent_id IS ? AND id IN (${ids.map(() => '?').join(', ')})`,
        )
        .bind(...ids, parentId, ...ids),
    );
  }
  return statements;
}

/**
 * Move a category one rank among its siblings (ticket #228): the whole family
 * is written 1 to n in the new order, in one batch. One read: the family of
 * the category, found through it. False when nothing moved — the category is
 * gone, or already first or last.
 */
export async function moveCategory(
  db: D1Database,
  id: number,
  direction: 'up' | 'down',
): Promise<boolean> {
  const { results } = await db
    .prepare(
      `SELECT id, name, position, parent_id FROM categories
        WHERE parent_id IS (SELECT parent_id FROM categories WHERE id = ?1)`,
    )
    .bind(id)
    .all<Ranked & { parent_id: number | null }>();
  const family = results ?? [];
  const order = moveWithinFamily(family, id, direction);
  if (!order) return false;
  const parentId = family[0].parent_id;
  await db.batch(positionStatements(db, parentId, new Map(order.map((cid, rank) => [cid, rank + 1]))));
  return true;
}

/**
 * Point a category at a media item, or clear it with null (ticket #158).
 *
 * Sourced from `media` in the same statement that writes it, like the logo
 * (`setLogoFromMedia`): a check-then-write leaves a window where the file is
 * deleted between the two, and the delete guard would then have nothing to
 * refuse. Returns false when the media row is gone (or the category is).
 */
export async function setCategoryImage(
  db: D1Database,
  id: number,
  imageKey: string | null,
): Promise<boolean> {
  const result = imageKey
    ? await db
        .prepare(
          `UPDATE categories
              SET image_key = (SELECT image_key FROM media WHERE image_key = ?2)
            WHERE id = ?1
              AND EXISTS (SELECT 1 FROM media WHERE image_key = ?2)`,
        )
        .bind(id, imageKey)
        .run()
    : await db.prepare('UPDATE categories SET image_key = NULL WHERE id = ?').bind(id).run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * Delete a category: reparent its direct children to its own parent (so the tree
 * stays connected), drop its product links, then remove it. FKs aren't enforced
 * on D1, so cleanup is explicit.
 *
 * The children join their parent's family by `arrivalPositions()`: last, in
 * their order, if that family was ranged; alphabetically if not. Read with the
 * family in one statement, written in the same batch as the reparenting.
 */
export async function deleteCategory(db: D1Database, id: number): Promise<void> {
  const cat = await getCategory(db, id);
  if (!cat) return;
  const { results } = await db
    .prepare(
      `SELECT id, name, position, parent_id FROM categories
        WHERE parent_id = ?1 OR (parent_id IS ?2 AND id != ?1)`,
    )
    .bind(id, cat.parent_id)
    .all<Ranked & { parent_id: number | null }>();
  const rows = results ?? [];
  const children = rows.filter((r) => r.parent_id === id);
  const placed = arrivalPositions(
    rows.filter((r) => r.parent_id !== id),
    children,
  );
  // Only what changes: a shop that ranges nothing writes no position at all.
  const changed = new Map(
    children
      .filter((c) => placed.get(c.id) !== c.position)
      .map((c) => [c.id, placed.get(c.id)!] as const),
  );
  await db.batch([
    ...positionStatements(db, id, changed),
    db.prepare('UPDATE categories SET parent_id = ? WHERE parent_id = ?').bind(cat.parent_id, id),
    db.prepare('DELETE FROM product_categories WHERE category_id = ?').bind(id),
    db.prepare('DELETE FROM categories WHERE id = ?').bind(id),
  ]);
}

/** All descendant ids of a category, including itself (recursive CTE). */
export async function descendantIds(db: D1Database, id: number): Promise<number[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM categories WHERE id = ?1
         UNION ALL
         SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
       )
       SELECT id FROM sub`,
    )
    .bind(id)
    .all<{ id: number }>();
  return (results ?? []).map((r) => r.id);
}

/** Ancestor chain from root down to the category itself (for breadcrumbs). */
export function ancestorsStatement(db: D1Database, id: number): D1PreparedStatement {
  return db
    .prepare(
      `WITH RECURSIVE up(id, name, slug, parent_id, created_at, depth) AS (
         SELECT id, name, slug, parent_id, created_at, 0 FROM categories WHERE id = ?1
         UNION ALL
         SELECT c.id, c.name, c.slug, c.parent_id, c.created_at, up.depth + 1
         FROM categories c JOIN up ON c.id = up.parent_id
       )
       SELECT id, name, slug, parent_id, created_at FROM up ORDER BY depth DESC`,
    )
    .bind(id);
}

export async function ancestors(db: D1Database, id: number): Promise<Category[]> {
  const { results } = await ancestorsStatement(db, id).all<Category>();
  return results ?? [];
}

/** Direct product count per category id (products tagged with that category). */
export async function productCounts(db: D1Database): Promise<Map<number, number>> {
  const { results } = await db
    .prepare('SELECT category_id, COUNT(*) AS n FROM product_categories GROUP BY category_id')
    .all<{ category_id: number; n: number }>();
  const counts = new Map<number, number>();
  for (const r of results ?? []) counts.set(r.category_id, r.n);
  return counts;
}

/** Categories assigned to a product. */
export function categoriesForProductStatement(
  db: D1Database,
  productId: number,
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT c.* FROM categories c
       JOIN product_categories pc ON pc.category_id = c.id
       WHERE pc.product_id = ? ORDER BY c.name`,
    )
    .bind(productId);
}

export async function categoriesForProduct(db: D1Database, productId: number): Promise<Category[]> {
  const { results } = await categoriesForProductStatement(db, productId).all<Category>();
  return results ?? [];
}

/** Categories for many products in one D1 query, keyed by product id. */
export async function categoriesForProducts(
  db: D1Database,
  productIds: number[],
): Promise<Map<number, Category[]>> {
  const ids = [...new Set(productIds.filter(Number.isInteger))];
  const byProduct = new Map<number, Category[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return byProduct;

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT pc.product_id,
              c.id, c.name, c.slug, c.parent_id, c.created_at
         FROM product_categories pc
         JOIN categories c ON c.id = pc.category_id
        WHERE pc.product_id IN (${placeholders})
        ORDER BY pc.product_id, c.name`,
    )
    .bind(...ids)
    .all<Category & { product_id: number }>();

  for (const { product_id, ...category } of results ?? []) {
    byProduct.get(product_id)?.push(category);
  }
  return byProduct;
}

/** Active products sharing a category with the given product (excludes
 *  itself), as SQL: bound (productId, limit). Exported for the card wrapper. */
export const RELATED_PRODUCTS_SQL = `SELECT DISTINCT p.* FROM products p
         JOIN product_categories pc ON pc.product_id = p.id
        WHERE pc.category_id IN (
                SELECT category_id FROM product_categories WHERE product_id = ?1
              )
          AND p.id != ?1 AND p.active = 1
        ORDER BY p.created_at DESC
        LIMIT ?2`;

/** Active products sharing a category with the given product (excludes itself). */
export function relatedProductsStatement(
  db: D1Database,
  productId: number,
  limit = 4,
): D1PreparedStatement {
  return db.prepare(RELATED_PRODUCTS_SQL).bind(productId, limit);
}

export async function relatedProducts(
  db: D1Database,
  productId: number,
  limit = 4,
): Promise<Product[]> {
  const { results } = await relatedProductsStatement(db, productId, limit).all<Product>();
  return results ?? [];
}

/**
 * Active products sharing ≥1 category with any of `productIds`, excluding those
 * ids themselves — used to top up a sparse search-results grid with on-topic
 * items. Newest first. Returns [] when there are no source ids or the limit ≤ 0.
 */
export async function productsInSharedCategories(
  db: D1Database,
  productIds: number[],
  limit: number,
): Promise<Product[]> {
  if (productIds.length === 0 || limit <= 0) return [];
  const ph = productIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT DISTINCT p.* FROM products p
         JOIN product_categories pc ON pc.product_id = p.id
        WHERE pc.category_id IN (
                SELECT category_id FROM product_categories WHERE product_id IN (${ph})
              )
          AND p.id NOT IN (${ph})
          AND p.active = 1
        ORDER BY p.created_at DESC
        LIMIT ?`,
    )
    .bind(...productIds, ...productIds, limit)
    .all<Product>();
  return results ?? [];
}

/** Replace a product's category links with the given set. */
export async function setProductCategories(
  db: D1Database,
  productId: number,
  categoryIds: number[],
): Promise<void> {
  const stmts = [
    db.prepare('DELETE FROM product_categories WHERE product_id = ?').bind(productId),
    ...categoryIds.map((cid) =>
      db
        .prepare(
          'INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?, ?)',
        )
        .bind(productId, cid),
    ),
  ];
  await db.batch(stmts);
}

/** A page of active products in a category and its descendants, as SQL:
 *  bound (categoryId, limit, offset). Exported for the card wrapper. */
export function productsInCategorySql(orderBy = 'created_at DESC'): string {
  return `WITH RECURSIVE sub(id) AS (
         SELECT id FROM categories WHERE id = ?1
         UNION ALL
         SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
       )
       SELECT DISTINCT p.* FROM products p
       JOIN product_categories pc ON pc.product_id = p.id
       WHERE pc.category_id IN (SELECT id FROM sub) AND p.active = 1
       ORDER BY ${orderBy}
       LIMIT ?2 OFFSET ?3`;
}

/** A page of active products in a category, including descendant categories. */
export function productsInCategoryStatement(
  db: D1Database,
  categoryId: number,
  limit: number,
  offset = 0,
  orderBy = 'created_at DESC',
): D1PreparedStatement {
  return db.prepare(productsInCategorySql(orderBy)).bind(categoryId, limit, offset);
}

export async function productsInCategory(
  db: D1Database,
  categoryId: number,
  limit: number,
  offset = 0,
  orderBy = 'created_at DESC',
): Promise<Product[]> {
  const { results } = await productsInCategoryStatement(db, categoryId, limit, offset, orderBy).all<Product>();
  return results ?? [];
}

/** Total active products in a category + its descendants (for pagination). */
export function countProductsInCategoryStatement(
  db: D1Database,
  categoryId: number,
): D1PreparedStatement {
  return db
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM categories WHERE id = ?1
         UNION ALL
         SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
       )
       SELECT COUNT(DISTINCT p.id) AS n FROM products p
       JOIN product_categories pc ON pc.product_id = p.id
       WHERE pc.category_id IN (SELECT id FROM sub) AND p.active = 1`,
    )
    .bind(categoryId);
}

export async function countProductsInCategory(
  db: D1Database,
  categoryId: number,
): Promise<number> {
  const row = await countProductsInCategoryStatement(db, categoryId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Direct children of a category (or top-level when parentId is null), in the
 *  order the merchant chose (`order.ts`). */
export function childrenOf(cats: Category[], parentId: number | null): Category[] {
  return cats.filter((c) => c.parent_id === parentId).sort(compareCategories);
}

/** Build a nested tree from the flat list. */
export function buildTree(cats: Category[]): CategoryNode[] {
  const byId = new Map<number, CategoryNode>();
  cats.forEach((c) => byId.set(c.id, { ...c, depth: 0, children: [] }));
  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id != null && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (nodes: CategoryNode[], depth: number) => {
    nodes.sort(compareCategories);
    for (const n of nodes) {
      n.depth = depth;
      sortRec(n.children, depth + 1);
    }
  };
  sortRec(roots, 0);
  return roots;
}

/** Flatten a tree to depth-tagged options (pre-order) for selects/checkboxes. */
export function flattenTree(nodes: CategoryNode[]): CategoryOption[] {
  const out: CategoryOption[] = [];
  const walk = (ns: CategoryNode[]) => {
    ns.forEach((n, i) => {
      out.push({
        id: n.id,
        public_id: n.public_id,
        name: n.name,
        slug: n.slug,
        depth: n.depth,
        first: i === 0,
        last: i === ns.length - 1,
      });
      walk(n.children);
    });
  };
  walk(nodes);
  return out;
}
