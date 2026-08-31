/**
 * The routes the browser suite walks, and what each one is there to catch.
 *
 * Every state comes from test/fixtures/storefront-states.sql — the same fixture
 * the HTML baselines and `npm run db:seed:storefront-states` use. A state that
 * existed only here would be a state nobody could open in a browser and look
 * at, which is the problem that fixture was written to solve.
 */
export const ROUTES = [
  { name: 'catalogue', path: '/', why: 'la grille, le tri, la pagination' },
  { name: 'catégorie', path: '/categories/apparel', why: 'la grille sous un autre titre' },
  { name: 'fiche produit', path: '/products/sample-tee', why: 'galerie, variantes, options' },
  { name: 'produit simple', path: '/products/pagination-item-2', why: 'ni variante ni option' },
  { name: 'produit épuisé', path: '/products/pagination-item-1', why: 'état épuisé' },
  { name: 'stock faible', path: '/products/pagination-item-5', why: 'la mention de rareté' },
  { name: 'recherche', path: '/search?q=sample', why: 'des résultats' },
  { name: 'recherche vide', path: '/search?q=zzzznomatch', why: 'aucun résultat' },
  { name: 'page de contenu', path: '/pages/about', why: 'la prose du marchand' },
  { name: 'panier', path: '/cart', why: 'le shell hors navigation' },
  { name: 'introuvable', path: '/no-such-page', why: 'la 404' },
];

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
