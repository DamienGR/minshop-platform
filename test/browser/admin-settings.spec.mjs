import { expect, test } from './fixtures.mjs';
import { REMOTE } from './pages.mjs';
import { signIn } from './admin.mjs';

/**
 * Admin → Réglages with its script running.
 *
 * With JavaScript the page saves a section in the background, and the server
 * answers a refusal with a 400 whose body is the reason. The script threw the
 * body away: at step 10 of the certification, a production refusing a test
 * Stripe key showed « Échec de l’enregistrement — réessayez », which retrying
 * cannot fix. The integration suites post the form without the script, where
 * the page re-renders with the reason, so only a browser sees this path.
 */

test.skip(REMOTE, 'une boutique déployée a son propre mot de passe : ces contrôles ne tournent que sur le jeu d’essai');

/** Logged in, on the Stripe card's form. */
async function stripeForm(page) {
  await signIn(page);
  await page.goto('/admin/settings#payments');
  const form = page.locator('form', { has: page.locator('input[name="_action"][value="save_stripe"]') });
  await form.locator('input[name="secret:stripe_secret_key"]').fill('pk_live_browser_suite');
  await form.locator('input[name="secret:stripe_webhook_secret"]').fill('whsec_browser_suite');
  return form;
}

test('un refus d’enregistrement dit sa raison, et la garde affichée', async ({ page }) => {
  const form = await stripeForm(page);
  await form.getByRole('button', { name: 'Enregistrer' }).click();

  const refusal = form.getByRole('alert');
  await expect(refusal).toHaveText(/^Ce n’est pas une clé secrète Stripe/);
  await expect(page.getByText('Échec de l’enregistrement — réessayez')).toHaveCount(0);
  // Longer than the confirmation toast lives: a reason is read, not glanced at.
  await page.waitForTimeout(3_000);
  await expect(refusal).toBeVisible();
});

test('un échec qui n’est pas un refus garde le message générique', async ({ page }) => {
  const form = await stripeForm(page);
  // Astro's own CSRF refusal: a 403 in English, not written for a merchant.
  await page.route('**/admin/settings', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 403, contentType: 'text/plain', body: 'Cross-site POST form submissions are forbidden' })
      : route.continue(),
  );
  await form.getByRole('button', { name: 'Enregistrer' }).click();

  await expect(form.getByText('Échec de l’enregistrement — réessayez')).toBeVisible();
  await expect(form.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Cross-site POST')).toHaveCount(0);
});

/**
 * Every entry of the sub-menu within reach (ticket #222). It scrolled sideways
 * with its scrollbar hidden, so past the width an entry could not be reached
 * with a mouse; it wraps now. Measured at both projects' widths and at a
 * narrow desktop window.
 */
test('le sous-menu de Réglages passe à la ligne, chaque entrée à portée', async ({ page }) => {
  await signIn(page);
  for (const width of [page.viewportSize().width, 640]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/admin/settings');
    const nav = page.locator('[data-settings-nav]');
    const { scrollWidth, clientWidth } = await nav.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth, `à ${width} px, le sous-menu défile de côté`).toBeLessThanOrEqual(clientWidth);
    const links = await nav.getByRole('link').all();
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) await expect(link).toBeInViewport({ ratio: 1 });
  }
});
