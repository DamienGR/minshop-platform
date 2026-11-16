import { expect, test } from './fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE, REMOTE, overflowOf, settle } from './pages.mjs';
import { signIn } from './admin.mjs';

/**
 * A rate's instructions for the buyer (ticket #237), from the admin field to
 * the rate step of /checkout, with the stylesheet and the scripts running.
 *
 * The integration suite proves the markup and the copy onto the order; only a
 * browser shows that the text stands under its rate on a phone without
 * pushing the page sideways, that a screen reader hears it as the radio's
 * description, that the card is marked once its rate is chosen, and that the
 * admin field saves through its own page.
 *
 * The store is left as it was found: the transfer, which opens the rate step
 * (the demo skips it), is closed again, and the field emptied. A store still
 * on its build-time rates keeps the same rates, saved by the admin page.
 */

test.skip(REMOTE, 'enregistre la livraison et un virement : ne tourne que sur le jeu d’essai');

const INSTRUCTIONS = [
  'Remis **en main propre**, contre signature.',
  '',
  '- du lundi au vendredi',
  '- un avis de passage sinon',
  '',
  '[Nos conditions](/pages/about)',
].join('\n');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Fill the first rate's field in Admin → Livraison and save; its label and a country it serves. */
async function setInstructions(page, text) {
  await page.goto('/admin/shipping');
  const field = page.locator('textarea[name$="[instructions]"]').first();
  const [, zone, rate] = (await field.getAttribute('name')).match(/^zone\[([^\]]+)\]\[rate\]\[([^\]]+)\]\[instructions\]$/);
  await field.fill(text);
  const label = await page.locator(`input[name="zone[${zone}][rate][${rate}][label]"]`).inputValue();
  const served = await page
    .locator(`select[name="zone[${zone}][countries][]"] option:checked`)
    .evaluateAll((options) => options.map((option) => option.value));
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/admin/shipping');
  await page.getByRole('button', { name: 'Enregistrer la livraison' }).click();
  expect((await saved).status(), 'la livraison n’a pas été enregistrée').toBeLessThan(400);
  // Read back from the stored document: the page names its fields afresh.
  await page.goto('/admin/shipping');
  await expect(page.locator('textarea[name$="[instructions]"]').first()).toHaveValue(text);
  return { label, country: served.find((code) => code !== '*') ?? 'FR' };
}

/** Open or close the transfer, the rail whose /checkout has a rate step. */
async function bankTransfer(page, open) {
  const response = await page.request.post('/admin/settings', {
    headers: { origin: new URL(page.url()).origin },
    form: {
      _action: 'save_bank_transfer',
      bank_transfer_holder: open ? 'Atelier Essai SARL' : '',
      bank_transfer_iban: open ? 'FR7630006000011234567890189' : '',
      bank_transfer_bic: '',
      bank_transfer_days: '',
    },
  });
  expect(response.status(), 'le virement n’a pas été enregistré').toBeLessThan(400);
}

test('les instructions d’un tarif se lisent sous lui, avant de payer', async ({ page }) => {
  test.skip(!FIXTURE.simple, 'aucun produit simple en stock dans ce catalogue');
  await signIn(page);
  const { label, country } = await setInstructions(page, INSTRUCTIONS);
  try {
    await bankTransfer(page, true);

    await page.goto(`/products/${FIXTURE.simple.slug}`);
    await settle(page);
    await page.locator('form[action="/api/cart"]').getByRole('button', { name: /panier/i }).first().click();
    await expect(page.locator('[data-cart-count-label]')).toContainText('1');

    await page.goto('/checkout?method=bank_transfer');
    const address = page.locator('form', { has: page.locator('input[name="line1"]:not([type="hidden"])') });
    await address.locator('input[name="email"]').fill('acheteur@exemple.fr');
    await address.locator('input[name="name"]').fill('Dominique Essai');
    await address.locator('input[name="line1"]').fill('3 quai Ceineray');
    await address.locator('input[name="city"]').fill('Nantes');
    await address.locator('input[name="postal"]').fill('44000');
    await address.locator('select[name="country"]').selectOption(country);
    const phone = address.locator('input[name="phone"]');
    if (await phone.count()) await phone.fill('06 39 98 00 02');
    await address.getByRole('button', { name: /continuer/i }).click();
    await settle(page);

    // The radio is described by the text under it, which stays outside its label.
    // Its name is the label and the price the label holds.
    const radio = page.locator(`input[name="shipping_label"][value="${label}"]`);
    await expect(radio).toHaveAccessibleDescription(
      /^Remis en main propre, contre signature\.\s*du lundi au vendredi\s*un avis de passage sinon\s*Nos conditions$/,
    );
    const card = page.locator('[data-rate-instructions]', { has: radio });
    const text = card.locator('.shipping-instructions');
    await expect(text).toBeVisible();
    await expect(text.locator('strong')).toHaveText('en main propre');
    await expect(text.locator('li')).toHaveCount(2);
    await expect(text.getByRole('link', { name: 'Nos conditions' })).toHaveAttribute('href', '/pages/about');
    await expect(card.locator('label a')).toHaveCount(0);

    // Chosen, the card says so, as a card without instructions does.
    const borderOf = () => card.evaluate((el) => getComputedStyle(el).borderColor);
    if ((await page.locator('input[name="shipping_label"]').count()) > 1) {
      const other = page.locator(`input[name="shipping_label"]:not([value="${label}"])`).first();
      await other.check();
      const idle = await borderOf();
      await card.locator('label').click();
      await expect(radio).toBeChecked();
      expect(await borderOf(), 'le tarif choisi ne se distingue pas').not.toBe(idle);
    } else {
      await expect(radio).toBeChecked();
    }

    expect(await overflowOf(page), 'la page défile de côté').toBe(0);
    const { violations } = await new AxeBuilder({ page }).include('fieldset').withTags(TAGS).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  } finally {
    await bankTransfer(page, false);
    await setInstructions(page, '');
  }
});
