/**
 * Audience measurement by Umami (ADR 0034): what a shop stores, and on which
 * pages the storefront loads the tracker.
 *
 * Two settings, written in Admin → Réglages → Mesure d'audience: the address
 * of the tracker script (Umami Cloud's or the agency's own server) and the
 * website ID Umami gave the shop. Both or neither: half a configuration loads
 * a script that counts nothing, so it is refused at the form and read as off.
 *
 * The browser loads the script from Umami's server directly — no relay through
 * the Worker, which would double the requests a page view costs. Umami sets no
 * cookie; what it does receive is decided here and in `beforeSend.ts`:
 *
 *  - never an admin URL: the storefront layout also draws /admin/login, the
 *    token door and the page preview, and none of them is an audience;
 *  - never a URL that is a capability. /order/<token> and /pay/<id> are read
 *    by whoever holds the link, which is why they answer `no-referrer`; the
 *    tracker would send that same URL to a third party, so a page that keeps
 *    its address from other sites keeps it from Umami too. Keyed on the
 *    header rather than on a list of routes, so a new token page that sets it
 *    is covered without anyone remembering this file;
 *  - never a query string or a fragment, except the campaign parameters
 *    (`beforeSend.ts`).
 *
 * Pure, with no import: settings/db.ts parses with it, and the admin form
 * validates with it.
 */

/** What a shop stores, both values checked. */
export interface UmamiSettings {
  /** The tracker script, https, as Umami's « Tracking code » gives it. */
  scriptUrl: string;
  /** The website ID, lower-case. */
  websiteId: string;
}

/** What the layout draws. */
export interface UmamiTag extends UmamiSettings {
  /** The one host Umami counts (`data-domains`), or null for any. */
  domain: string | null;
}

export type UmamiFormError =
  | 'admin.settings.audience.error.scriptUrl'
  | 'admin.settings.audience.error.websiteId'
  | 'admin.settings.audience.error.incomplete';

/** Umami Cloud's tracker: the form's example address. */
export const UMAMI_CLOUD_SCRIPT = 'https://cloud.umami.is/script.js';

/** Longer than any tracker address; a pasted page is not one. */
export const UMAMI_SCRIPT_URL_MAX = 300;

const WEBSITE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The tracker's address, or null when it is not an https URL. */
export function normalizeUmamiScriptUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value || value.length > UMAMI_SCRIPT_URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // https only: an http script on an https page is blocked as mixed content,
  // and anything else is not a script address. No credentials, no fragment.
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
  return url.href;
}

/** The website ID, lower-case, or null when it is not a UUID. */
export function normalizeUmamiWebsiteId(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().toLowerCase();
  return WEBSITE_ID.test(value) ? value : null;
}

/** Both stored values, or null when either is missing or not valid. */
export function parseUmamiSettings(
  scriptUrl: string | null | undefined,
  websiteId: string | null | undefined,
): UmamiSettings | null {
  const url = normalizeUmamiScriptUrl(scriptUrl);
  const id = normalizeUmamiWebsiteId(websiteId);
  return url && id ? { scriptUrl: url, websiteId: id } : null;
}

/** One attribute of a pasted `<script …>` tag, or ''. */
function attribute(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

/**
 * The form's two fields → what to store. The merchant may paste Umami's whole
 * « Tracking code » into the first field: its `src` and `data-website-id` are
 * read out of it, and only those two values are kept, never the tag. Two empty
 * fields switch the measurement off.
 */
export function parseUmamiForm(
  rawScript: string,
  rawWebsiteId: string,
): { ok: true; value: UmamiSettings | null } | { ok: false; error: UmamiFormError } {
  let script = rawScript.trim();
  let websiteId = rawWebsiteId.trim();
  if (/<script\b/i.test(script)) {
    websiteId ||= attribute(script, 'data-website-id');
    script = attribute(script, 'src');
  }
  if (!script && !websiteId) return { ok: true, value: null };
  if (!script || !websiteId) return { ok: false, error: 'admin.settings.audience.error.incomplete' };
  const scriptUrl = normalizeUmamiScriptUrl(script);
  if (!scriptUrl) return { ok: false, error: 'admin.settings.audience.error.scriptUrl' };
  const id = normalizeUmamiWebsiteId(websiteId);
  if (!id) return { ok: false, error: 'admin.settings.audience.error.websiteId' };
  return { ok: true, value: { scriptUrl, websiteId: id } };
}

/** True for /admin and everything under it. */
function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/**
 * The tracker this page draws, or null for none.
 *
 * `referrerPolicy` is the header the page has set on its response by the time
 * the layout renders (the page's frontmatter runs first). `canonicalHost` is
 * the shop's public host when CANONICAL_ORIGIN names one: Umami then counts
 * that host only, and a preview on workers.dev counts nothing.
 */
export function umamiTag(
  settings: UmamiSettings | null | undefined,
  page: { pathname: string; referrerPolicy: string | null; canonicalHost: string | null },
): UmamiTag | null {
  if (!settings) return null;
  if (isAdminPath(page.pathname)) return null;
  if ((page.referrerPolicy ?? '').trim().toLowerCase() === 'no-referrer') return null;
  return { ...settings, domain: page.canonicalHost || null };
}
