/**
 * The hardening every response leaves with — the one place it is written down.
 *
 * A store answers from two servers, not one. The Worker produces pages, APIs,
 * redirects and errors; Cloudflare's asset server produces /favicon.svg,
 * /placeholder.* and everything under /_astro/, and it answers those AHEAD of
 * the Worker, so `src/middleware.ts` never sees them. Both halves have to be
 * told the same rules, and the second is told by `public/_headers`.
 *
 * Two lists in two files is exactly the kind of pair that drifts: someone adds
 * a header to the middleware, the static half keeps shipping without it, and
 * nothing says so. So the list lives here, the middleware reads it, and
 * securityHeaders.test.ts reads `public/_headers` and refuses a difference.
 */

/** Set on every response, overwriting whatever a route said. */
export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff', // don't MIME-sniff responses
  'x-frame-options': 'DENY', // block framing (clickjacking) — nothing here is meant to be embedded
  'strict-transport-security': 'max-age=31536000; includeSubDomains', // force HTTPS for a year
};

/**
 * Store-wide referrer floor, set only when the route said nothing.
 *
 * The routes that carry a capability in their URL — /order/<token>,
 * /pay/<token> and the download beneath them — set `no-referrer` themselves,
 * and an unconditional `set()` would quietly downgrade the one header keeping
 * an order's bearer token out of a third party's access log.
 */
export const DEFAULT_REFERRER_POLICY = 'strict-origin-when-cross-origin';
