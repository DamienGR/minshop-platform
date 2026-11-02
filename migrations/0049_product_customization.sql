-- Migration 0049: customisable products (ticket #125, ADR 0022).
--
-- `product_custom_fields` holds the free-text fields a merchant asks on a
-- product ("Nom à broder", at most 15 characters): a label, a help text shown
-- under the field, a maximum length, whether it must be filled in, and an
-- order. Catalogue, like the variants and extras of 0017; a product without
-- one sells as before.
--
-- What a buyer types is copied, never referenced: `order_items.customization`
-- is a JSON array of { label, value }, the label as it read when the order was
-- placed, so renaming or removing a field later does not change what was sold.
-- It is the buyer's text and may name somebody, so it lives apart from
-- `order_items.name` (an accounting record the erasure keeps) and the erasure
-- empties it (shopctl/src/privacy/map.mjs).
--
-- `checkout_reservations.customization` carries it from the checkout to the
-- order, as `ship_address` does: one JSON entry per line of `items`, in the same
-- order, null for a line without any. Settlement copies it onto the order
-- lines and clears it; a released reservation clears it at once; an expired or
-- failed one keeps it three days, past Stripe's webhook retries, and the sweep
-- that hides its guest link clears it.
CREATE TABLE IF NOT EXISTS product_custom_fields (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id   TEXT,                       -- cfld_
  product_id  INTEGER NOT NULL REFERENCES products(id),
  label       TEXT    NOT NULL,           -- "Nom à broder"
  help_text   TEXT,                       -- shown under the field; NULL = none
  max_length  INTEGER NOT NULL,           -- characters, 1 to 200
  required    INTEGER NOT NULL DEFAULT 1, -- 1 = the buyer must fill it in
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_custom_fields_product ON product_custom_fields(product_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_custom_fields_public_id
  ON product_custom_fields(public_id) WHERE public_id IS NOT NULL;

ALTER TABLE order_items ADD COLUMN customization TEXT;
ALTER TABLE checkout_reservations ADD COLUMN customization TEXT;
