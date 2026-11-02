-- Migration 0051: the VAT exemption an order was sold under (ticket #148, ADR 0024).
--
-- A seller in franchise en base de TVA (art. 293 B du CGI) charges no VAT and
-- says so on every document standing in for an invoice. The order records it
-- itself rather than leaving the page to read today's configuration: a
-- micro-entreprise that crosses the threshold becomes liable from that day,
-- and the orders it sold before must keep their mention, as the orders sold
-- after must not carry it.
--
-- 'franchise', or NULL. An exempt order records `vat_rate_bps` and
-- `vat_amount_cents` at 0 beside it — "there was no VAT" — where an order with
-- no recorded split keeps them NULL — "we do not know" (ADR 0010).
--
-- The exemption rides the reservation from the checkout to the settlement, as
-- the rate does (migration 0041): the webhook that writes the order never saw
-- the buyer.
ALTER TABLE orders ADD COLUMN vat_exemption TEXT;
ALTER TABLE checkout_reservations ADD COLUMN vat_exemption TEXT;
