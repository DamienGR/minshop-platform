import { expect, test as base } from '@playwright/test';
import { REMOTE } from './pages.mjs';
import { remoteTarget } from '../remote/target.mjs';

/**
 * `test` and `expect`, with one addition for a deployed shop behind Cloudflare
 * Access (a private preview, ADR 0015): the service token rides on every
 * request to the shop's OWN origin, and on nothing else.
 *
 * Not `extraHTTPHeaders`, which Playwright sends to every host the page
 * reaches — Turnstile, a payment page, a font CDN. A service token handed to a
 * third party is a leaked credential, and the specs would never notice.
 */
const target = REMOTE ? remoteTarget() : null;

export const test = base.extend({
  context: async ({ context }, use) => {
    if (target?.behindAccess) {
      await context.route(
        (url) => url.origin === target.origin,
        (route) => route.continue({ headers: { ...route.request().headers(), ...target.accessHeaders } }),
      );
    }
    await use(context);
  },
});

export { expect };
