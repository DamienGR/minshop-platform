import { expect, test } from './fixtures.mjs';
import { FIXTURE, overflowOf, settle } from './pages.mjs';

/**
 * The branches a shop only meets on a bad day.
 *
 * The container contracts already pin the MARKUP of these states — a role, a
 * non-empty message, two renders that differ. What they cannot see is whether
 * the state survives being laid out: an empty page that collapses to nothing, a
 * sold-out card that looks purchasable, a hostile query that reaches FTS5 and
 * returns a 500 with a stack trace on it.
 */

test('un catalogue vide s’annonce au lieu d’afficher une grille blanche', async ({ page }) => {
  test.skip(!FIXTURE.emptyCategory, 'état propre au jeu d’essai : une boutique déployée n’a pas de catégorie vide à montrer');
  const response = await page.goto(FIXTURE.emptyCategory);
  expect(response?.status()).toBe(200);
  await settle(page);

  const status = page.getByRole('status');
  await expect(status).toBeVisible();
  await expect(status).not.toBeEmpty();
  await expect(page.locator('main a[href^="/products/"]')).toHaveCount(0);
  // The page still has a header, a footer and a heading — an empty listing is
  // not an empty document.
  await expect(page.locator('h1')).toBeVisible();
  expect(await overflowOf(page)).toBe(0);
});

test('un produit épuisé le dit et n’offre pas de l’acheter', async ({ page }) => {
  test.skip(!FIXTURE.soldOut, 'aucun produit épuisé dans ce catalogue');
  await page.goto(`/products/${FIXTURE.soldOut.slug}`);
  await settle(page);

  // The wording belongs to the design; that the state is expressed does not.
  await expect(page.getByText(/épuisé/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /ajouter au panier/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /acheter maintenant/i })).toHaveCount(0);
});

test('un stock faible se distingue d’une disponibilité normale', async ({ page }) => {
  test.skip(!FIXTURE.lowStock, 'aucun produit en stock faible parmi ceux examinés');
  await page.goto(`/products/${FIXTURE.lowStock.slug}`);
  await settle(page);

  const nudge = page.locator('[data-low-stock]');
  await expect(nudge).toBeVisible();
  // Scarcity must never become a published count.
  await expect(nudge).not.toHaveText(/\d+\s*(restant|left|en stock)/i);
});

/**
 * FTS5 `MATCH` throws on raw input — an unbalanced quote is enough — so every
 * query goes through a sanitizer first. That sanitizer is exactly the kind of
 * code that gets refactored by someone who has never seen it throw, and the
 * symptom is a 500 on a search box, in production, from a shopper who typed an
 * apostrophe.
 */
const HOSTILE = [
  ['une apostrophe', "l'été"],
  ['des guillemets déséquilibrés', '"soldes'],
  ['des opérateurs FTS', 'NEAR/2 (a b) OR *'],
  ['une parenthèse seule', 'tee)'],
  ['un tiret initial', '-tee'],
  ['du vide', '   '],
];

for (const [what, q] of HOSTILE) {
  test(`la recherche encaisse ${what}`, async ({ page }) => {
    const response = await page.goto(`/search?q=${encodeURIComponent(q)}`);

    expect(response?.status(), `« ${q} » a répondu ${response?.status()}`).toBe(200);
    await settle(page);
    await expect(page.locator('h1')).toBeVisible();
    expect(await overflowOf(page)).toBe(0);
  });
}
