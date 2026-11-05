import { expect, test } from './fixtures.mjs';
import { REMOTE } from './pages.mjs';
import { ADMIN_PASSWORD } from './admin.mjs';

/**
 * The admin guide (ticket #188) and the footer that opens it (ticket #186).
 *
 * The panel is a script: it fetches the guide, opens it beside the screen on
 * the screen's chapter, and keeps it open from one screen to the next. None of
 * that exists in a container render, and the integration suites post forms
 * without a browser. The no-JavaScript path, a plain link to /admin/guide, is
 * checked here too, since only a browser can turn the script off.
 */

test.skip(REMOTE, 'une boutique déployée a son propre mot de passe : ces contrôles ne tournent que sur le jeu d’essai');

const GUIDE = 'Guide de l’administration';

async function login(page, path) {
  await page.goto('/admin/login');
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  await Promise.all([page.waitForURL((url) => !url.pathname.startsWith('/admin/login')), page.locator('button[type="submit"]').click()]);
  await page.goto(path);
}

const footerLink = (page) => page.locator('[data-admin-footer]').getByRole('link', { name: GUIDE });

test('le pied de page ouvre le guide à côté de l’écran, sur son chapitre', async ({ page }) => {
  await login(page, '/admin/orders');
  await expect(page.locator('[data-admin-footer]')).toContainText(/Socle minshop v\d+\.\d+\.\d+/);

  const link = footerLink(page);
  await expect(link).toHaveAttribute('aria-expanded', 'false');
  await link.click();

  const panel = page.locator('#admin-guide');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#guide-orders')).toBeInViewport();
  await expect(panel.getByRole('heading', { name: GUIDE })).toBeFocused();
  await expect(link).toHaveAttribute('aria-expanded', 'true');
  // The merchant is still on the screen: the guide came to it.
  await expect(page).toHaveURL(/\/admin\/orders$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Commandes' })).toBeAttached();
});

// The address is the var the deployment passes (MINSHOP_SUPPORT_EMAIL, from
// serve.mjs here): the one path from the deploying environment to the footer
// that no unit test walks.
test('le pied de page écrit au support à l’adresse que le déploiement passe', async ({ page }) => {
  await login(page, '/admin/orders');
  const support = page.locator('[data-admin-footer]').getByRole('link', { name: 'Vous rencontrez un problème' });
  await expect(support).toHaveAttribute('href', /^mailto:support@agence\.example\?subject=/);
});

test('le guide reste ouvert d’un écran à l’autre, au même endroit, et Échap le referme', async ({ page }) => {
  await login(page, '/admin/products');
  await footerLink(page).click();
  const panel = page.locator('#admin-guide');
  await expect(panel.locator('#guide-products')).toBeInViewport();

  await page.goto('/admin/categories');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#guide-products')).toBeInViewport();

  await panel.locator('#admin-guide-title').focus();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(footerLink(page)).toBeFocused();

  // Closed is remembered as well as open.
  await page.goto('/admin/customers');
  await expect(panel).toBeHidden();
});

test('le sommaire du panneau fait défiler le guide, pas l’écran ni son adresse', async ({ page }) => {
  await login(page, '/admin');
  await footerLink(page).click();
  const panel = page.locator('#admin-guide');
  await expect(panel.locator('#guide-dashboard')).toBeInViewport();

  await panel.locator('.admin-guide-contents').getByRole('link', { name: 'Livraison' }).click();
  await expect(panel.locator('#guide-shipping')).toBeInViewport();
  await expect(page).toHaveURL(/\/admin\/?$/);

  await panel.getByRole('button', { name: 'Fermer' }).click();
  await expect(panel).toBeHidden();
});

test('sans script, le pied de page mène au guide en pleine page', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await login(page, '/admin/orders');

  await footerLink(page).click();
  await expect(page).toHaveURL(/\/admin\/guide#guide-orders$/);
  await expect(page.getByRole('heading', { level: 1, name: GUIDE })).toBeVisible();
  await expect(page.locator('#guide-orders')).toBeAttached();
  // One guide on the page: no panel to hold a second copy of every id.
  await expect(page.locator('#admin-guide')).toBeHidden();
  await context.close();
});
