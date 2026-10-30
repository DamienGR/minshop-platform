-- Migration 0048: the relay point a shopper picked at checkout (ADR 0020;
-- plan §13.3, lot 4).
--
-- `relay_point` is a JSON snapshot of the point as the shop served it: the
-- Boxtal offer that fixes its network, the point's code, name and address.
-- A copy rather than a reference, because Boxtal cannot read a point back by
-- its code (ADR 0021) and a point that closes later does not change what was
-- sold.
--
-- It rides on the reservation, as the terms acceptance and the VAT rate do:
-- the reservation is the one row every rail writes before the shopper leaves,
-- and `recordPaidOrder` copies it onto the order from there. The pending
-- payment needs no copy of its own: every rail that writes one settles
-- through the same reservation.
--
-- `delivery_method` takes a third value, `relay`, beside `shipping` and
-- `pickup`: the column is free text, so that needs no statement here.
ALTER TABLE checkout_reservations ADD COLUMN relay_point TEXT;
ALTER TABLE orders ADD COLUMN relay_point TEXT;
