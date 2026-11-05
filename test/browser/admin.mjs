import { pbkdf2Sync, randomBytes } from 'node:crypto';

/**
 * The fixture store's admin login, for the specs that drive the admin.
 *
 * Shared by serve.mjs, which stores its hash, and the specs, which type it.
 * A fixture value on a throwaway database, never a deployed shop's: the specs
 * that use it skip against BASE_URL.
 */
export const ADMIN_PASSWORD = 'browser suite admin password';

/**
 * The stored form src/features/auth/password.ts verifies:
 * `pbkdf2$<iterations>$<saltB64>$<hashB64>`, PBKDF2-HMAC-SHA256. Derived here
 * with node:crypto because serve.mjs runs as plain Node, without type stripping.
 */
export function adminPasswordHash(password = ADMIN_PASSWORD) {
  const iterations = 100_000;
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return `pbkdf2$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** The session one sign-in gave this worker, replayed on every later context. */
let session = null;

/**
 * Signed in as the fixture's admin, on `page`'s browser context.
 *
 * One POST to /admin/login per worker, and its session cookie replayed after
 * that. The edge limiter takes ten logins a minute from a client
 * (AUTH_RATE_LIMITER, wrangler.template.jsonc), and a login per test had
 * brought the suite to eleven within one minute on a fast runner: the
 * eleventh was refused, and an unrelated spec went red (PR #197). The session
 * is a signed token, so no logout elsewhere in the run revokes it.
 * `admin-edit-link.spec.mjs` keeps its own login: the hint cookie it checks
 * is set by that very request.
 */
export async function signIn(page) {
  const context = page.context();
  if (session) {
    await context.addCookies(session);
    return;
  }
  await page.goto('/admin/login');
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/admin/login')),
    page.locator('button[type="submit"]').click(),
  ]);
  session = (await context.cookies()).filter((cookie) => cookie.name === 'admin_session');
  if (session.length === 0) throw new Error('signing in left no admin_session cookie');
}
