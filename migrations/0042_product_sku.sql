-- 0042: a SKU on products. Additive; the column is NULL everywhere it existed.
--
-- Variants have carried one since 0017 because a variant IS the inventory unit
-- there. A simple product had nowhere to put the merchant's own reference, so
-- the catalogue import (plan §5.4) had no stable identity to be idempotent on:
-- the slug moves when a name is corrected, and the row id is the store's own
-- invention, absent from the CSV the merchant maintains.
--
-- Partial UNIQUE index rather than a UNIQUE column. Two reasons, and both are
-- about rows that already exist: a UNIQUE column would have made every product
-- without a reference collide on NULL in some engines, and the partial form
-- says the invariant precisely — at most one product per non-empty SKU, any
-- number of products without one. On a store upgrading to this migration the
-- column is new, so the index cannot fail on data already written.
--
-- product_variants.sku deliberately gets NO index here. It has been free text in
-- the admin since 0017, so a store may already hold duplicates, and a migration
-- that fails on a shop's own data is a migration that cannot be shipped to a
-- fleet. The importer refuses an ambiguous SKU at plan time instead, and
-- `shopctl catalog validate` reports the existing duplicates as a blocking
-- finding — a check that can name the two rows, which an index cannot.
ALTER TABLE products ADD COLUMN sku TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku
  ON products (sku) WHERE sku IS NOT NULL;
