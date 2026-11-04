import { expect, test } from './fixtures.mjs';
import { FIXTURE, REMOTE } from './pages.mjs';
import { ADMIN_PASSWORD } from './admin.mjs';

/**
 * The admin's shortcut from a product page to its screen (ticket #178).
 *
 * The integration gate proves the server half: the page is the same shared
 * bytes for everyone, the hint is written beside a verified session, the probe
 * answers the admin alone. Only a browser runs the script that joins them, so
 * only a browser can say the link appears for the admin, takes them to the
 * right screen, and stays out of a shopper's sight and network.
 */

test.skip(REMOTE, 'une boutique déployée a son propre mot de passe : ces contrôles ne tournent que sur le jeu d’essai');

const product = `/products/${FIXTURE.gallery.slug}`;
const shortcut = (page) => page.getByRole('link', { name: 'Modifier ce produit' });

test('un acheteur ne voit pas le raccourci, et sa page ne demande rien à l’admin', async ({ page }) => {
  const probes = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/admin/')) probes.push(request.url());
  });
  await page.goto(product);
  await page.waitForLoadState('networkidle');
  await expect(shortcut(page)).toHaveCount(0);
  expect(probes).toEqual([]);
});

test('l’admin connecté va de la fiche produit à son écran de modification', async ({ page }) => {
  await page.goto('/admin/login');
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/admin/login')),
    page.locator('button[type="submit"]').click(),
  ]);

  await page.goto(product);
  const link = shortcut(page);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /^\/admin\/products\/prod_[^/]+\/edit$/);
  await Promise.all([page.waitForURL(/\/admin\/products\/prod_[^/]+\/edit$/), link.click()]);
  await expect(page.locator('input[name="name"]')).toHaveValue(FIXTURE.gallery.name);

  // Logged out, the same page no longer offers it.
  await page.goto('/admin/logout');
  await page.goto(product);
  await page.waitForLoadState('networkidle');
  await expect(shortcut(page)).toHaveCount(0);
});

test('un indice périmé ne montre rien, et s’efface', async ({ page, context, baseURL }) => {
  // The hint outlived the session (expired, password rotated): the probe is
  // refused, the link stays hidden, and the next page does not ask again.
  await context.addCookies([{ name: 'admin_hint', value: '1', url: baseURL }]);
  const refused = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/admin/session');
  await page.goto(product);
  expect((await refused).status()).toBe(401);
  await expect(shortcut(page)).toHaveCount(0);
  await expect.poll(async () => (await context.cookies()).some((cookie) => cookie.name === 'admin_hint')).toBe(false);
});
