import type { APIRoute } from 'astro';
import { PUBLIC_CACHE_CONTROL } from '../features/cache/public';
import { env } from 'cloudflare:workers';
import { listProducts, countProducts } from '../features/products/db';
import { listVisibleCategories } from '../features/categories/db';
import { listPublishedPages } from '../features/pages/db';
import { publicOrigin } from '../features/http/origin';
import { sitemapLocs } from '../features/seo/sitemap';

export const prerender = false;

// Dynamic sitemap: storefront + every active product, visible category, and published page. Slugs are
// URL-safe (a-z0-9-), so no XML escaping is needed.
export const GET: APIRoute = async ({ url, locals }) => {
  const origin = publicOrigin(url.origin, env.CANONICAL_ORIGIN);
  const total = await countProducts(env.DB);
  const products = total > 0 ? await listProducts(env.DB, total, 0) : [];
  const categories = await listVisibleCategories(env.DB);
  const pages = await listPublishedPages(env.DB);

  const locs = sitemapLocs(origin, locals.settings?.homePage, { categories, products, pages });

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((l) => `  <url><loc>${l}</loc></url>`).join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': PUBLIC_CACHE_CONTROL,
    },
  });
};
