-- Migration 0065: discount codes typed in the cart (plan §13.32, ADR 0033).
--
-- `discount_codes` holds the codes the merchant creates in Admin → Codes
-- promo: a percentage or a fixed amount off the items, a minimum basket, the
-- days it holds (the shop's calendar, both included) and how many orders may
-- use it. A gift card is a fixed amount used once. The socle judges a code and
-- computes what it takes off, whatever the payment: Stripe receives the
-- amount, never the code.
--
-- `code` is stored in capitals, as the cart compares it; `public_id` (dsc_)
-- addresses it in the admin. A code an order used is never deleted, only
-- switched off: the order keeps its own copy of the text all the same.
--
-- A use is counted where it is held, never in a counter: the orders that
-- carry the code, and the reservations still waiting for their payment. The
-- reservation insert judges the limit in the same statement that takes the
-- stock (features/orders/reservations.ts), so two buyers of a single-use code
-- cannot both get it; an abandoned checkout gives the use back with its stock.
CREATE TABLE IF NOT EXISTS discount_codes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id           TEXT    NOT NULL UNIQUE,          -- dsc_
  code                TEXT    NOT NULL UNIQUE,          -- "NOEL10", capitals
  kind                TEXT    NOT NULL,                 -- 'percent' | 'amount'
  value               INTEGER NOT NULL,                 -- percent 1-100, or minor units
  min_subtotal_cents  INTEGER NOT NULL DEFAULT 0,       -- items before the code; 0 = none
  starts_on           TEXT,                             -- 'YYYY-MM-DD' or NULL
  ends_on             TEXT,                             -- 'YYYY-MM-DD' or NULL, included
  max_uses            INTEGER,                          -- NULL = no limit
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Carried from the checkout to the order like the terms acceptance: the code
-- as applied, and the row whose limit it counts against.
ALTER TABLE checkout_reservations ADD COLUMN discount_code_id INTEGER; -- → discount_codes.id
ALTER TABLE checkout_reservations ADD COLUMN discount_code TEXT;
ALTER TABLE orders ADD COLUMN discount_code_id INTEGER;               -- → discount_codes.id
ALTER TABLE orders ADD COLUMN discount_code TEXT;
-- What the rails without a provider of their own (Lightning, OpenNode, the
-- transfer, the demo) took off: their pay page shows it, the order records it.
ALTER TABLE pending_payments ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;

-- Counting a code's uses reads these, never the whole history.
CREATE INDEX IF NOT EXISTS idx_orders_discount_code
  ON orders(discount_code_id) WHERE discount_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checkout_reservations_discount_code
  ON checkout_reservations(discount_code_id, status) WHERE discount_code_id IS NOT NULL;
