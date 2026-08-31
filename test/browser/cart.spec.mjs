import { expect, test } from '@playwright/test';
import { settle } from './pages.mjs';

/**
 * Adding to the cart, with scripts and without — invariant 1 as a test rather
 * than as a comment.
 *
 * "Progressive enhancement" is the kind of claim that stays true in the README
 * long after it stopped being true in the code, because the enhanced path is
 * the only one anybody exercises. These two tests are the same purchase,
 * twice, and the no-JavaScript one is the one that matters: it is what a
 * shopper gets on a flaky connection, behind a corporate proxy that strips
 * scripts, or on the render a crawler sees.
 */

test('avec JavaScript, l’ajout ouvre le tiroir sans quitter la page', async ({ page }) => {
  await page.goto('/products/pagination-item-2');
  await settle(page);

  const url = page.url();
  await page.getByRole('button', { name: /panier/i }).first().click();

  const drawer = page.locator('[data-cart-drawer]');
  await expect(drawer).not.toHaveClass(/invisible/);
  // Not navigating IS the enhancement. If the drawer opened and the page also
  // moved, the script is decorating a full page load rather than replacing it.
  expect(page.url()).toBe(url);
  await expect(page.locator('[data-cart-count-label]')).toContainText('1');
});

test.describe('sans JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('le catalogue et la navigation restent entiers', async ({ page }) => {
    await page.goto('/');
    await settle(page);

    await expect(page.locator('main a[href^="/products/"]').first()).toBeVisible();
    // The images must be VISIBLE, not merely present: the fade enhancement
    // hides them at opacity 0 until a script adds a class, so a fade applied
    // from CSS alone would leave a scriptless visitor on a blank grid.
    await expect(page.locator('main img').first()).toBeVisible();
    const opacity = await page
      .locator('main img')
      .first()
      .evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacity)).toBeGreaterThan(0);
  });

  test('l’ajout au panier reste un vrai formulaire', async ({ page }) => {
    await page.goto('/products/pagination-item-2');
    // Settle BEFORE aiming at the button. Without it the hero image lands late
    // on a slow link, the form shifts under the pointer, and Playwright — quite
    // correctly — refuses to click a moving control.
    await settle(page);

    const form = page.locator('form[action="/api/cart"]');
    await expect(form).toHaveAttribute('method', /post/i);

    // The click navigates, so the wait is armed before it rather than after:
    // a submit that resolves faster than the next statement would otherwise
    // race the assertion.
    await Promise.all([
      page.waitForURL('**/cart'),
      form.getByRole('button', { name: /panier/i }).first().click(),
    ]);
    await expect(page.locator('body')).toContainText('Pagination Item 2');
  });

  test('la fiche produit montre son image principale', async ({ page }) => {
    await page.goto('/products/sample-tee');
    await settle(page);

    const hero = page.locator('[data-hero-track] img').first();
    await expect(hero).toBeVisible();
    expect(
      await hero.evaluate((el) => el.complete && el.naturalWidth > 0),
      'l’image principale ne s’est pas chargée',
    ).toBe(true);
  });
});
