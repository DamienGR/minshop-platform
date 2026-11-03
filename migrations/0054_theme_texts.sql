-- Migration 0054: the texts a theme lets the merchant edit (ticket #165).
--
-- A theme declares its slots in its own `texts.ts` (key, label, default,
-- maximum length, plain text or Markdown); this table holds only what the
-- merchant WROTE over a default. No row = the theme's default, so a theme that
-- declares nothing reads nothing, and a merchant who empties a field gets the
-- default back rather than a blank block. Keys the active theme no longer
-- declares are kept and ignored: switching back to it finds them again.
--
-- `value` is checked against the slot's maximum by the admin, not here: the
-- maximum is the theme's, and it moves with a deploy, not with a migration.
-- Markdown is rendered with `html: false` (invariant 11), like a page body.
CREATE TABLE IF NOT EXISTS theme_texts (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
