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

/** Wait for the page to be settled enough to measure: fonts resolved, the
 *  reveal animation finished. Both move geometry, and both finish on their own —
 *  polling for them beats sleeping through the slowest possible case. */
export async function settle(page) {
  await page.waitForLoadState('domcontentloaded');
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
