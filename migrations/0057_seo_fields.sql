-- Migration 0057: what a search engine shows of a page, written by the merchant
-- (ticket #216).
--
-- A product, a category and a content page each take a title and a description
-- for search results. Both are optional: NULL keeps the title and description
-- the storefront layout derives today (`{name} — {store}`, the first words of
-- the text), so no existing shop changes. The home page's pair is two settings
-- (Admin → Réglages → Général), not columns: it belongs to no row.
--
-- Plain text, one line. The description is at most 160 characters, the length
-- the layout already keeps; the title has a 60-character guide, not a limit.
-- Both are checked by the forms and the catalogue import, not here: a CHECK
-- cannot be added to an existing table without rebuilding it.
ALTER TABLE products ADD COLUMN seo_title TEXT;
ALTER TABLE products ADD COLUMN seo_description TEXT;
ALTER TABLE categories ADD COLUMN seo_title TEXT;
ALTER TABLE categories ADD COLUMN seo_description TEXT;
ALTER TABLE pages ADD COLUMN seo_title TEXT;
ALTER TABLE pages ADD COLUMN seo_description TEXT;
