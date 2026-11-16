/**
 * The categories a visitor cannot see (ticket #240, migration 0062): each one
 * the merchant hid, then every category under one — hidden means the whole
 * branch. A self-contained subquery, for `id NOT IN ${HIDDEN_CATEGORY_IDS}`:
 * every storefront read that lists, links or opens a category goes through it,
 * so the rule is written once. A LEAF with no imports: the menus read it in
 * the middleware's batch (`navigation/db.ts`), the categories' reads in `db.ts`.
 *
 * Not correlated, so SQLite runs it once per statement. It starts from the
 * partial index `idx_categories_hidden`: in a shop that hides nothing, its
 * cost does not grow with the categories, which matters because the menus
 * read it on every request (`test/integration/category-hidden.mjs`). UNION, not
 * UNION ALL: a cycle the admin refuses could only come from a hand-made row,
 * and would end here instead of looping.
 */
export const HIDDEN_CATEGORY_IDS = `(WITH RECURSIVE hidden_branch(id) AS (
           SELECT id FROM categories WHERE hidden = 1
           UNION
           SELECT c.id FROM categories c JOIN hidden_branch h ON c.parent_id = h.id
         )
         SELECT id FROM hidden_branch)`;
