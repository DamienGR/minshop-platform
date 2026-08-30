-- The VAT split an order has to carry.
--
-- France sells TTC, so the tax is INSIDE the total rather than added to it —
-- `orders.tax_cents` keeps its own meaning (tax added on top, what Stripe Tax
-- computes for exclusive pricing) and stays 0 on a TTC shop. Conflating the two
-- would make the total of every historical order ambiguous.
--
-- The RATE is captured at checkout, on the reservation, for the same reason the
-- terms acceptance is: it is the rate in force when the buyer agreed to the
-- price, and re-deriving it at settlement from today's configuration would
-- rewrite the split of an order placed the day before a rate change.
ALTER TABLE orders ADD COLUMN vat_rate_bps INTEGER;
ALTER TABLE orders ADD COLUMN vat_amount_cents INTEGER;

ALTER TABLE checkout_reservations ADD COLUMN vat_rate_bps INTEGER;
