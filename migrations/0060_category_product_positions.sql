-- Migration 0060: the order the merchant gives the products of a category
-- (ticket #239).
--
-- Admin → Catégories → « Ordre des produits » numbers the products a category
-- page shows, and that page follows the numbers under its « Par défaut » sort,
-- the bare /categories/<slug>. Nouveautés, Prix and Nom stay as they were.
--
-- A table of its own rather than a column on `product_categories`: a category
-- page lists the products of its sub-categories too, and the merchant orders
-- what the page shows, so a row may name a product that is not linked to the
-- category itself (src/features/categories/productOrder.ts).
--
-- A category with no row has no order: its page sorts by Nouveautés, exactly
-- as before, and offers no « Par défaut ». A save writes the whole list 1 to n
-- in one batch; a product with no row — created, or linked to the category
-- since — follows the placed ones, newest first, until the merchant places it.
-- A row whose product has left the category reads nothing and is dropped at
-- the next save; deleting the product or the category deletes its rows.
--
-- The primary key serves the storefront's lookup (category, product); the
-- index on `product_id` serves the deletion of a product.
CREATE TABLE IF NOT EXISTS category_product_positions (
  category_id INTEGER NOT NULL REFERENCES categories(id),
  product_id  INTEGER NOT NULL REFERENCES products(id),
  position    INTEGER NOT NULL,
  PRIMARY KEY (category_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_cpp_product ON category_product_positions(product_id);
