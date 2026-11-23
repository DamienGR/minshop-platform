/**
 * The shop's figures for the period (ADR 0035), read from its production D1
 * with SELECTs, and nothing personal in any of them.
 *
 * Every statement is an aggregate: a count, a sum, a product's name. An
 * order's address, a buyer's e-mail or name never leaves the database — the
 * distinct buyers are counted IN the query. The report is published in the
 * shop's repository, private (publish.mjs refuses any other), and is not the
 * merchant's accounting: it states the figures, it does not justify them.
 *
 * Revenue is the admin dashboard's (`features/orders/db.ts`): `orders` holds
 * paid orders only (invariant 2), gross is `amount_total_cents`, net takes
 * `refunded_cents` off, and amounts are integer minor units formatted at the
 * edge. `created_at` is UTC; the bounds come from period.mjs.
 *
 * `wrangler d1 execute` binds no parameter, so the only values written into a
 * statement are timestamps this module formats itself and slugs it checks.
 */
import { sqlTimestamp } from './period.mjs';

const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The settings the report reads: the shop's name and its Umami site. */
export const SETTINGS_SQL = "SELECT key, value FROM settings WHERE key IN ('store_name', 'umami_script_url', 'umami_website_id');";

function bounds(span, column = 'created_at') {
  const from = sqlTimestamp(span.start);
  const to = sqlTimestamp(span.end);
  if (!TIMESTAMP.test(from) || !TIMESTAMP.test(to)) throw new Error(`borne de période invalide : ${from} / ${to}`);
  return `${column} >= '${from}' AND ${column} < '${to}'`;
}

/** Orders, gross, refunded and distinct buyers over a span. */
export function totalsSql(span) {
  return `SELECT COUNT(*) AS orders, COALESCE(SUM(amount_total_cents), 0) AS gross_cents, COALESCE(SUM(refunded_cents), 0) AS refunded_cents, COUNT(DISTINCT lower(email)) AS buyers FROM orders WHERE ${bounds(span)};`;
}

/** The five products sold most, by units, over a span. */
export function topProductsSql(span, limit = 5) {
  return `SELECT oi.name AS name, SUM(oi.quantity) AS quantity, SUM(oi.price_cents * oi.quantity) AS cents FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${bounds(span, 'o.created_at')} GROUP BY oi.name ORDER BY quantity DESC, cents DESC LIMIT ${Number(limit)};`;
}

/** The statements of the sales section, in the order `summariseSales` reads them. */
export function salesStatements(period) {
  return [totalsSql(period), topProductsSql(period), ...(period.previous ? [totalsSql(period.previous)] : [])];
}

const number = (value) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function totals(row) {
  const orders = number(row?.orders);
  const gross = number(row?.gross_cents);
  const refunded = number(row?.refunded_cents);
  return {
    orders,
    grossCents: gross,
    refundedCents: refunded,
    netCents: gross - refunded,
    averageCents: orders > 0 ? Math.round(gross / orders) : null,
    buyers: number(row?.buyers),
  };
}

/** The result sets of `salesStatements`, as the report's figures. */
export function summariseSales(results, period) {
  const [current = [], top = [], previous = null] = results;
  return {
    ...totals(current[0]),
    top: top.map((row) => ({ name: String(row.name ?? ''), quantity: number(row.quantity), cents: number(row.cents) })),
    previous: period.previous && previous ? totals(previous[0]) : null,
  };
}

/** The settings rows, as a map. */
export function readSettings(rows) {
  const map = new Map((rows ?? []).map((row) => [String(row.key), row.value == null ? null : String(row.value)]));
  return {
    storeName: map.get('store_name')?.trim() || null,
    umamiScriptUrl: map.get('umami_script_url')?.trim() || null,
    umamiWebsiteId: map.get('umami_website_id')?.trim().toLowerCase() || null,
  };
}

/**
 * The names of the storefront pages a list of paths points at, in one
 * statement: products, categories and content pages by slug. A path this
 * cannot name keeps its path.
 */
export function titlesSql(paths) {
  const slugs = { products: new Set(), categories: new Set(), pages: new Set() };
  for (const path of paths) {
    const match = String(path).match(/^\/(products|categories|pages)\/([^/?#]+)\/?$/);
    if (match && SLUG.test(match[2])) slugs[match[1]].add(match[2]);
  }
  const parts = [];
  const list = (set) => [...set].map((slug) => `'${slug}'`).join(', ');
  if (slugs.products.size) parts.push(`SELECT 'products' AS kind, slug, name AS title FROM products WHERE slug IN (${list(slugs.products)})`);
  if (slugs.categories.size) parts.push(`SELECT 'categories' AS kind, slug, name AS title FROM categories WHERE slug IN (${list(slugs.categories)})`);
  if (slugs.pages.size) parts.push(`SELECT 'pages' AS kind, slug, title FROM pages WHERE slug IN (${list(slugs.pages)})`);
  return parts.length ? `${parts.join(' UNION ALL ')};` : null;
}

/** The pages every shop has, named the way the storefront names them. */
const FIXED_TITLES = {
  '/': 'Accueil',
  '/products': 'Tous les produits',
  '/cart': 'Panier',
  '/checkout': 'Commande',
  '/search': 'Recherche',
};

/** `[feuille] Notre atelier` → `Notre atelier`: a theme's title codes (ticket
 *  #251) are drawings, not words. */
const plain = (title) => String(title).replace(/\s*\[[a-z0-9-]+\]\s*/g, ' ').replace(/\s+/g, ' ').trim();

/** path → title, from the rows of `titlesSql`. */
export function titleIndex(rows) {
  const index = new Map(Object.entries(FIXED_TITLES));
  for (const row of rows ?? []) {
    if (row?.kind && row?.slug && row?.title) index.set(`/${row.kind}/${row.slug}`, plain(row.title));
  }
  return (path) => index.get(String(path).replace(/(.)\/$/, '$1')) ?? null;
}

/**
 * Money, from minor units, in French. The currency's own number of decimals
 * (none for the yen) is what Intl says it is.
 */
export function formatMoney(cents, currency = 'EUR') {
  const format = new Intl.NumberFormat('fr-FR', { style: 'currency', currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(cents / 10 ** digits);
}

/** A count, in French: `1 234`. */
export function formatCount(value) {
  return new Intl.NumberFormat('fr-FR').format(value);
}
