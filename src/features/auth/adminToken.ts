import type { D1Database } from '@cloudflare/workers-types';

/**
 * One-time admin tokens (ticket #227, ADR 0032): a way into the admin for whoever
 * holds the shop's Cloudflare account, without knowing the merchant's password
 * and without replacing it.
 *
 * The admin has ONE password (features/auth/admin.ts), and the merchant may
 * change it. Before this, the agency's only way back in was `shopctl admin
 * password`, which replaces it: the merchant lost their sessions and had to be
 * sent a new one. A token gives nothing that account does not already give —
 * only someone who can write to the shop's D1 can create one — and it leaves the
 * password, and the merchant's sessions, as they are.
 *
 * Three properties carry the design:
 *
 *  - **the database holds a digest, never the token.** `shopctl admin token`
 *    draws 32 random bytes, shows them once, and writes their SHA-256. A digest
 *    needs no slow KDF: there is no guessing 256 random bits, unlike a password;
 *  - **used once, in one statement.** `consumeAdminToken()` marks the row used
 *    in the same UPDATE that checks it unused and unexpired, so two posts of one
 *    token racing each other open one session, never two;
 *  - **the session it opens is an ordinary one**, signed like the login's and
 *    bound to the current password hash, only shorter. When the merchant changes
 *    the password, it falls with the others.
 *
 * The rows a token leaves once used are kept: they are the record the merchant
 * reads in Réglages (« Dernier accès de l'agence »). Rows never used are dropped
 * once expired. Pure apart from the `db` it is handed — no `cloudflare:workers`,
 * so the CLI imports this module to generate and digest, and vitest loads it.
 */

/** How long a token may wait to be used, from the moment it is written. */
export const ADMIN_TOKEN_TTL_SECONDS = 15 * 60;

/** The session a token opens: a working session, not the login's seven days. */
export const ADMIN_TOKEN_SESSION_SECONDS = 8 * 3600;

/** 32 random bytes: 43 characters of unpadded base64url. */
const TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** A new token, from the platform CSPRNG. Shown once, never stored. */
export function generateAdminToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * What was typed, as a token, or null when it cannot be one. A paste from a
 * terminal can carry spaces or a line break around it; nothing else is
 * forgiven, and a malformed value never reaches the database.
 */
export function normalizeAdminToken(input: string | null | undefined): string | null {
  const token = (input ?? '').trim();
  return TOKEN_RE.test(token) ? token : null;
}

/** The SHA-256 of a token, in hex: what the database holds and looks up. */
export async function adminTokenDigest(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Use a token: true exactly once, for a token that exists, has not been used
 * and has not expired. Tokens that expired unused are dropped in the same batch.
 */
export async function consumeAdminToken(db: D1Database, token: string, now: number): Promise<boolean> {
  const digest = await adminTokenDigest(token);
  const [, consumed] = await db.batch([
    db.prepare('DELETE FROM admin_access_tokens WHERE used_at IS NULL AND expires_at <= ?').bind(now),
    db
      .prepare(
        'UPDATE admin_access_tokens SET used_at = ?1 WHERE digest = ?2 AND used_at IS NULL AND expires_at > ?1',
      )
      .bind(now, digest),
  ]);
  return consumed.meta.changes === 1;
}

/** When a token was last used, in seconds since the epoch, or null if never. */
export async function lastAdminTokenUse(db: D1Database): Promise<number | null> {
  const row = await db
    .prepare('SELECT MAX(used_at) AS used_at FROM admin_access_tokens')
    .first<{ used_at: number | null }>();
  return row?.used_at ?? null;
}
