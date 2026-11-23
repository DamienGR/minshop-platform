/**
 * The function Umami calls before each send (`data-before-send`, Umami 2.18
 * and later), installed by `UmamiTracker.astro` ahead of the tracker.
 *
 * The tracker runs with `data-exclude-search`, so the URL it reports carries
 * no query string: a search, a sort, a page number or anything a future route
 * puts there stays in the browser. This puts back the campaign parameters
 * alone (`utm_source`, `utm_medium`…), which are how a merchant tells a
 * newsletter from an Instagram post. A server older than 2.18 ignores the
 * hook and sends the bare path: less, never more.
 *
 * It also stops the send in a browser that opened the admin recently (the
 * `admin_hint` cookie of ticket #178): the merchant's own visits are not an
 * audience. The hint is never an authority, and here it does not need to be:
 * forging it only keeps a visitor out of the count.
 *
 * A leaf importing only the hint's leaf: it ships to the browser.
 */
import { hasAdminHint } from '../auth/adminHint.ts';

/** A campaign parameter: utm_source, utm_medium, utm_campaign, utm_term, utm_content… */
const CAMPAIGN_PARAM = /^utm_[a-z]+$/;

/** The campaign parameters of `search`, encoded, or '' when it has none. */
export function campaignQuery(search: string): string {
  const kept = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(search)) {
    if (CAMPAIGN_PARAM.test(key)) kept.append(key, value);
  }
  return kept.toString();
}

/** `url` with the page's campaign parameters added back. */
export function withCampaign(url: string, search: string): string {
  const query = campaignQuery(search);
  if (!query) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

/** The payload to send, or false to send nothing. */
export function beforeSend(
  payload: unknown,
  page: { cookies: string; search: string },
): unknown {
  if (hasAdminHint(page.cookies)) return false;
  if (payload && typeof payload === 'object' && typeof (payload as { url?: unknown }).url === 'string') {
    const url = (payload as { url: string }).url;
    return { ...payload, url: withCampaign(url, page.search) };
  }
  return payload;
}

/** The global the tracker's `data-before-send` names. */
export const BEFORE_SEND_GLOBAL = 'minshopUmamiBeforeSend';
