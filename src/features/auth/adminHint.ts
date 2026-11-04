/**
 * The storefront's shortcut to a product's admin screen (ticket #178), and the
 * one cookie that tells a page it may show it.
 *
 * Storefront pages are shared at the edge (`features/cache/public.ts`): the
 * HTML an admin receives is the HTML every shopper receives, so it cannot
 * carry the answer to "is this the admin?". The page carries the shortcut
 * hidden, with no href, and its script decides on two signals, in order:
 *
 *   1. ADMIN_HINT_COOKIE, readable by script, written by the middleware beside
 *      a session it has just verified. It says this browser opened the admin
 *      recently, nothing more: it is never an authority, and forging it shows
 *      a link to the login form. Its job is to keep a shopper's page from
 *      asking anything at all: without it, the script stops there.
 *   2. ADMIN_PROBE_PATH, under /api/admin, so the gate that guards every admin
 *      route answers it. Only a 200 that says so shows the link. A refusal
 *      clears the hint, so an expired session or a rotated password stops
 *      costing the request.
 *
 * A leaf with no imports: the client script imports it, and must not pull the
 * rest of the auth code into the browser.
 */

export const ADMIN_HINT_COOKIE = 'admin_hint';

/** As long as a password session (`admin/login.astro`). */
export const ADMIN_HINT_MAX_AGE = 7 * 24 * 3600;

/** Answered by `pages/api/admin/session.ts`, behind the admin gate. */
export const ADMIN_PROBE_PATH = '/api/admin/session';

/** True when a `document.cookie` (or a Cookie header) carries the hint. */
export function hasAdminHint(cookies: string): boolean {
  return cookies.split(';').some((part) => part.trim() === `${ADMIN_HINT_COOKIE}=1`);
}

/** The probe's answer for a caller the gate let through. */
export function isAdminProbeAnswer(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { admin?: unknown }).admin === true;
}

/** The admin screen of a product, by its `prod_` public ID (never a row id). */
export function productEditHref(publicId: string): string {
  return `/admin/products/${encodeURIComponent(publicId)}/edit`;
}
