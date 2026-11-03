-- Migration 0052: a category's image and short description (ticket #158).
--
-- A shop's home presents its "univers" — the top-level categories — each with
-- a photo and a sentence, before the rest. Both are optional: a category with
-- neither renders exactly as before, and the shipped themes read neither.
--
-- `image_key` records a USE of a media item, never ownership (invariant 10),
-- like `products.image_key` and the logo setting: removing the image from the
-- category clears the column only, and `/api/admin/media/:id` refuses to
-- delete a file a category still names. The write is sourced from `media` in
-- the same statement, so a file deleted meanwhile cannot leave a dangling key.
--
-- `description` is plain text, at most 300 characters (checked by the form,
-- not here: a CHECK cannot be added to an existing table without rebuilding
-- it). NULL = none.
ALTER TABLE categories ADD COLUMN image_key TEXT;
ALTER TABLE categories ADD COLUMN description TEXT;
