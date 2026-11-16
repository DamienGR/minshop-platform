-- Migration 0062: a category the merchant hides (ticket #240).
--
-- « Cacher cette catégorie » in Admin → Catégories takes it off the storefront
-- without deleting it: its page answers 404, as a draft page or an inactive
-- product does, and it leaves the home, /products, the menus, sitemap.xml,
-- llms.txt, the product page and the public API. Its sub-categories go with
-- it: hidden means the whole branch. Its products stay on sale — a product is
-- hidden by its own « Actif » box.
--
-- 0 for every existing row: nothing changes until a merchant ticks the box.
--
-- The rule is one subquery, `HIDDEN_CATEGORY_IDS` in
-- src/features/categories/visibility.ts: each hidden category, then every category
-- under one. The middleware reads it on every storefront request (a menu item
-- may point at a hidden category), so it starts from this partial index: in a
-- shop that hides nothing its cost does not grow with the categories, and one
-- that does reads the hidden branches only, down `idx_categories_parent`.
ALTER TABLE categories ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_categories_hidden ON categories(id) WHERE hidden = 1;
