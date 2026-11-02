import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig } from '../config';
import { contactSettings } from '../features/contact';
import { publishedPagePath } from '../features/pages/db';
import { vaultReady } from '../features/secrets/store';
import { t } from '../features/i18n';

/**
 * `/contact`, the address a merchant can print (ADR 0025): a temporary
 * redirect to the page the form sits under, or a 404 while there is none.
 *
 * Temporary on purpose. The merchant can move the form to another page, or
 * take it down; a 301 would keep sending every browser that saw it once to
 * wherever the form was that day. The form itself lives on its page, which is
 * what the navigation links to and the sitemap lists — this route renders
 * nothing.
 */
export const GET: APIRoute = async ({ locals }) => {
  const contact = contactSettings(locals.settings, getConfig().email.notifyTo, {
    vault: vaultReady(),
    emailBinding: !!env.EMAIL,
  });
  const path = contact ? await publishedPagePath(env.DB, contact.pageId) : null;
  if (!path) {
    return new Response(t('http.notFound'), {
      status: 404,
      headers: { 'cache-control': 'private, no-store', 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(null, {
    status: 302,
    headers: { location: path, 'cache-control': 'private, no-store' },
  });
};
