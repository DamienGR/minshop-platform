import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Whether the suite drives a DEPLOYED shop (BASE_URL set) rather than the
 * fixture store that serve.mjs boots. See playwright.config.mjs.
 */
export const REMOTE = Boolean(process.env.BASE_URL);

/**
 * The kinds of page the specs need, and where to find each.
 *
 * Locally, every state comes from test/fixtures/storefront-states.sql — the
 * same fixture the HTML baselines and `npm run db:seed:storefront-states` use.
 * A state that existed only here would be a state nobody could open in a
 * browser and look at, which is the problem that fixture was written to solve.
 *
 * Against a deployed shop, the same kinds are discovered in the merchant's own
 * catalogue (remote-routes.mjs). A kind it does not have is null, and the spec
 * that needs it skips with that reason instead of passing on another page.
 */
export const FIXTURE = REMOTE
  ? discovered()
  : {
      simple: { slug: 'pagination-item-2', name: 'Pagination Item 2' },
      gallery: { slug: 'sample-tee', name: 'Sample Tee' },
      soldOut: { slug: 'pagination-item-1' },
      lowStock: { slug: 'pagination-item-5' },
      category: '/categories/apparel',
      emptyCategory: '/categories/bientot',
      page: '/pages/about',
      search: 'sample',
    };

/**
 * Discovery runs once per run, not once per worker: the runner and each worker
 * import this module, and they share the environment, so the first answer is
 * left there for the others.
 */
function discovered() {
  process.env.MINSHOP_REMOTE_FIXTURE ??= execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./remote-routes.mjs', import.meta.url))],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return JSON.parse(process.env.MINSHOP_REMOTE_FIXTURE);
}

/** The routes the browser suite walks, and what each one is there to catch. */
export const ROUTES = [
  { name: 'catalogue', path: '/', why: 'la grille, le tri, la pagination' },
  { name: 'catégorie', path: FIXTURE.category, why: 'la grille sous un autre titre' },
  { name: 'fiche produit', path: FIXTURE.gallery && `/products/${FIXTURE.gallery.slug}`, why: 'galerie, variantes, options' },
  { name: 'produit simple', path: FIXTURE.simple && `/products/${FIXTURE.simple.slug}`, why: 'ni variante ni option' },
  { name: 'produit épuisé', path: FIXTURE.soldOut && `/products/${FIXTURE.soldOut.slug}`, why: 'état épuisé' },
  { name: 'stock faible', path: FIXTURE.lowStock && `/products/${FIXTURE.lowStock.slug}`, why: 'la mention de rareté' },
  { name: 'recherche', path: FIXTURE.search && `/search?q=${encodeURIComponent(FIXTURE.search)}`, why: 'des résultats' },
  { name: 'recherche vide', path: '/search?q=zzzznomatch', why: 'aucun résultat' },
  { name: 'page de contenu', path: FIXTURE.page, why: 'la prose du marchand' },
  { name: 'panier', path: '/cart', why: 'le shell hors navigation' },
  { name: 'introuvable', path: '/no-such-page', why: 'la 404' },
].filter((route) => route.path);

/**
 * Wait until the page has stopped moving.
 *
 * Three things move geometry after first paint, and all three have to be done
 * before anything measures a box or clicks a control: images arriving and
 * resizing their boxes, fonts swapping, and the core `.reveal` animation
 * sliding its element into place. Each finishes on its own, so this polls for
 * the end rather than sleeping through the slowest possible case.
 *
 * `load` and not `domcontentloaded` — that difference is a red CI run. On a
 * fast local network the images were there before any test looked; on the
 * runner they were not, the purchase form kept shifting under a late-loading
 * hero, and Playwright refused to click a moving button until the test timed
 * out. Reproduced by throttling the network to 30 kB/s, which fails on
 * `domcontentloaded` and passes on `load`.
 */
export async function settle(page) {
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const animations = document.getAnimations?.() ?? [];
        Promise.all(animations.map((a) => a.finished.catch(() => {}))).then(resolve);
        setTimeout(resolve, 2000);
      }),
  );
}

/** Pixels the document scrolls horizontally. Zero is the contract. */
export const overflowOf = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
