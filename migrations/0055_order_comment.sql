-- Migration 0055: the buyer's comment on an order (ticket #162, ADR 0028).
--
-- A free message the buyer leaves before paying, when the merchant has
-- switched it on (Admin → Réglages, `order_comment_enabled`): a delivery
-- detail, a gift message, the personalisation an artisan is asked for. One
-- per order, apart from the per-line text of a personalised product (0049).
--
-- It is the buyer's text and may name somebody, so it is a column of its own
-- that the erasure empties (shopctl/src/privacy/map.mjs), never part of an
-- accounting field.
--
-- `checkout_reservations.buyer_comment` carries it from the checkout to the
-- order, as `customization` does: settlement copies it onto
-- `orders.buyer_comment` and clears it; a released reservation clears it at
-- once; an expired or failed one keeps it three days, past Stripe's webhook
-- retries, and the sweep that hides its guest link clears it.
ALTER TABLE checkout_reservations ADD COLUMN buyer_comment TEXT;
ALTER TABLE orders ADD COLUMN buyer_comment TEXT;
