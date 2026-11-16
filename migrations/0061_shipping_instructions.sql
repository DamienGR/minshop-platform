-- Migration 0061: a shipping rate's instructions for the buyer (ticket #237).
--
-- A rate of Admin → Livraison may carry Markdown the buyer reads under it at
-- /checkout: for a pickup, the address, the hours and how to agree on a time.
-- The rate lives in the shipping document (settings, version 6); the order
-- keeps its own copy, taken when it is paid as `shipping_label` is, so a rate
-- edited afterwards changes nothing a paid order shows or sends.
--
-- It reaches the order the way the label does: `pending_payments` for the
-- rails that settle from their pending row (Lightning, OpenNode, the bank
-- transfer, the demo), the chosen Stripe rate's metadata for a card.
--
-- The merchant's text, about a rate: no buyer in it, nothing for the erasure.
ALTER TABLE orders ADD COLUMN shipping_instructions TEXT;
ALTER TABLE pending_payments ADD COLUMN shipping_instructions TEXT;
