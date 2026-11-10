-- Migration 0058: one-time admin tokens (ticket #227, ADR 0032).
--
-- `shopctl admin token` lets whoever holds the shop's Cloudflare account into
-- the admin without knowing the merchant's password, and without replacing it.
-- The row holds the SHA-256 of the token, never the token. It is good once,
-- for fifteen minutes (src/features/auth/adminToken.ts): `used_at` is set by
-- the one statement that checks it, so a token cannot open two sessions.
--
-- A used row is kept: it is the record the merchant reads in Réglages
-- (« Dernier accès de l'agence »), hence the index on `used_at`. A row that
-- expired unused is dropped by the next token used or written.
CREATE TABLE IF NOT EXISTS admin_access_tokens (
  digest TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_admin_access_tokens_used
  ON admin_access_tokens (used_at);
