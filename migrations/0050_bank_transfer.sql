-- Migration 0050: payment by bank transfer (ticket #146, ADR 0023).
--
-- A transfer the shop waits for is a `pending_payments` row with backend
-- 'bank_transfer', never an order (invariant 2): the merchant records it as
-- received in the admin, which writes the paid order, or abandons it. Its
-- stock is held by the checkout reservation it names, for the number of days
-- set in Admin → Réglages → Paiements; the cron releases it at the deadline.
-- The rail needs no new column: the row already carries the amount, the
-- e-mail, the address and the reservation, and its status takes one more
-- value, 'abandoned'.
--
-- The orders page lists the transfers still awaited on every visit. The table
-- keeps a row for every Lightning and demo checkout ever opened, and D1 bills
-- the rows a query scans, so the list reads through this index instead of the
-- table's whole history (test/integration/history-reads.mjs).
CREATE INDEX IF NOT EXISTS idx_pending_payments_backend_status
  ON pending_payments (backend, status, created_at);
