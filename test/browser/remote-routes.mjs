#!/usr/bin/env node
/**
 * The routes of a DEPLOYED shop, discovered from what it publishes.
 *
 * The local suite walks the fixture catalogue (test/fixtures/storefront-states.sql):
 * `sample-tee`, `pagination-item-1`, the `bientot` category. A deployed shop
 * has the merchant's catalogue instead, so the same specs need the same KINDS
 * of page, found in that catalogue — through the two documents every shop
 * publishes to anyone: the JSON catalogue (`/api/products`) and the sitemap.
 *
 * A kind the catalogue does not have (nothing sold out, no published page) is
 * reported as null, and the spec that needs it skips with that reason rather
 * than passing on a page that is not what it claims to be.
 *
 * Run as a child process by pages.mjs, synchronously, because Playwright
 * collects tests at import time and a route list has to exist by then. Prints
 * one JSON document on stdout.
 */
import { fetchAs, remoteTarget } from '../remote/target.mjs';

const target = remoteTarget();

async function json(path) {
  const response = await fetchAs(target, path, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} a répondu ${response.status}`);
  return response.json();
}

const products = [];
for (let offset = 0; offset < 500; offset += 100) {
  const page = await json(`/api/products?limit=100&offset=${offset}`);
  products.push(...(page.products ?? []));
  if ((page.products ?? []).length < 100) break;
}

const sitemap = await (await fetchAs(target, '/sitemap.xml')).text();
const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => new URL(loc).pathname);

const inStock = products.filter((product) => product.in_stock);
// The richest page the catalogue has: a variant group first (it brings the
// picker), then a real photo, then anything in stock. The list's `image` is
// the product's own key only, so a gallery held in media rows reads as a
// placeholder there; the page itself is what the spec looks at.
const rich =
  inStock.find((product) => product.variant_label) ??
  inStock.find((product) => !/placeholder/.test(product.image)) ??
  inStock[0] ??
  null;
const soldOut = products.find((product) => !product.in_stock) ?? null;

// The list flags a variant group but not add-ons; only the detail says both.
// A dozen candidates is enough to find a plain product in a real catalogue
// without the discovery becoming a crawl.
let simple = null;
for (const product of inStock.filter((candidate) => !candidate.variant_label).slice(0, 12)) {
  const detail = await json(`/api/products/${encodeURIComponent(product.slug)}`);
  if (!(detail.variants?.length > 0) && !(detail.extras?.length > 0)) {
    simple = product;
    break;
  }
}

// Low stock is not in the public catalogue on purpose (serialize.ts: an exact
// count leaks sales velocity), so it is found the way a shopper finds it — on
// the page. Same bound.
let lowStock = null;
for (const product of inStock.slice(0, 12)) {
  const html = await (await fetchAs(target, `/products/${encodeURIComponent(product.slug)}`)).text();
  if (html.includes('data-low-stock')) {
    lowStock = product;
    break;
  }
}

// A word from a real product name, long enough to be a search and plain
// enough to survive the FTS sanitizer unchanged.
const word = (simple ?? inStock[0])?.name.split(/[^\p{L}\p{N}]+/u).find((part) => part.length >= 4) ?? null;

const pick = (product) => (product ? { slug: product.slug, name: product.name } : null);
process.stdout.write(
  `${JSON.stringify({
    origin: target.origin,
    products: products.length,
    simple: pick(simple),
    gallery: pick(rich),
    soldOut: pick(soldOut),
    lowStock: pick(lowStock),
    // A deployed shop's categories are the merchant's; an EMPTY one is a state
    // the fixture store holds for the template's sake, not something to find.
    emptyCategory: null,
    category: paths.find((path) => path.startsWith('/categories/')) ?? null,
    page: paths.find((path) => path.startsWith('/pages/')) ?? null,
    search: word,
  })}\n`,
);
