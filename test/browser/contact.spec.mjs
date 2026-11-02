import { expect, test } from './fixtures.mjs';
import { FIXTURE, settle } from './pages.mjs';

/**
 * The contact form (ADR 0025) without JavaScript — invariant 1, on the one
 * storefront form that writes to the merchant.
 *
 * The integration suite posts the form with no browser at all, which proves
 * the server and not the page: that the labels name their fields, that the
 * browser's own checks let a refusable value through to the server, and that
 * the refusal lands back on a page a person can read, with their text still
 * in it. A message the visitor has to type twice is a message that is not
 * sent.
 */
test.describe('sans JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('le formulaire de contact est un vrai formulaire, et un refus garde le texte', async ({ page }) => {
    test.skip(!FIXTURE.contact, 'pas de page de contact à poster dans cette boutique');
    await page.goto(FIXTURE.contact);
    await settle(page);

    const form = page.locator('#contact form');
    await expect(form).toHaveAttribute('method', /post/i);

    // The trap is no field a person meets: inside a 1-pixel clipped box, out
    // of the tab order. The input keeps its own size; what clips it is the
    // box around it.
    const trap = page.locator('input[name="website"]');
    await expect(trap).toHaveAttribute('tabindex', '-1');
    const frame = await page.locator('div[aria-hidden="true"]:has(input[name="website"])').boundingBox();
    expect(frame && frame.width <= 1 && frame.height <= 1, JSON.stringify(frame)).toBe(true);

    const message = 'Un tablier brodé à mon prénom, est-ce possible ?';
    await page.getByLabel('Nom', { exact: true }).fill('Claire Dubois');
    // The browser takes an address without a dot in its domain; the server
    // does not, which is what puts this refusal on the server's side.
    await page.getByLabel('E-mail', { exact: true }).fill('claire@exemple');
    await page.getByLabel('Motif', { exact: true }).selectOption({ index: 1 });
    await page.getByLabel('Message', { exact: true }).fill(message);

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST'),
      form.getByRole('button').click(),
    ]);
    expect(response.status()).toBe(400);
    await page.waitForLoadState('load');

    const email = page.getByLabel('E-mail', { exact: true });
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#contact-email-error')).toBeVisible();
    await expect(email).toHaveValue('claire@exemple');
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(message);
    await expect(page.getByLabel('Nom', { exact: true })).toHaveValue('Claire Dubois');
  });
});
