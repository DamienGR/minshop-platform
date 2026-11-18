import { expect, test } from './fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';
import { FIXTURE, REMOTE, settle } from './pages.mjs';
import { signIn } from './admin.mjs';

/**
 * A personalisation field that goes with an extra (migration 0064), from the
 * admin's « Afficher » choice to the product page, with the stylesheet and the
 * scripts running, and without the scripts.
 *
 * The integration suite proves the markup and the server's rules: the field
 * under its box, required with it, its text dropped without it. Only a browser
 * shows that the field is out of sight until the box is ticked, that a ticked
 * box makes it required before anything is sent, that unticking hides and
 * disables it again, and that without a script the stylesheet alone still
 * shows it once the box is ticked.
 *
 * The store is left as it was found: the field is added to the fixture's
 * gallery product, beside its « Gift wrap » extra, and removed at the end.
 */

test.skip(REMOTE, 'enregistre un champ sur un produit : ne tourne que sur le jeu d’essai');

const product = `/products/${FIXTURE.gallery.slug}`;
const LABEL = 'Prénom à broder';
const EXTRA = 'Gift wrap';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
/**
 * The set-up's own page, on a desktop in both projects: the `browser` fixture
 * hands a new page the project's device, and the admin's long product screen
 * is the set-up here, not the subject.
 */
const DESKTOP = { viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false };

/** Open the product's admin screen, let `edit` change its personalisation rows, save. */
async function editFields(page, edit) {
  await signIn(page);
  await page.goto(product);
  const id = await page.locator('form[action="/api/cart"] input[name="product_id"]').first().inputValue();
  await page.goto(`/admin/products/${id}/edit`);
  await settle(page);
  const section = page.locator('#personnalisation');
  await edit(section);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith('/edit') || url.searchParams.has('error')),
    section.getByRole('button', { name: 'Enregistrer les modifications' }).click(),
  ]);
  expect(new URL(page.url()).searchParams.get('error'), 'le produit n’a pas été enregistré').toBeNull();
}

test.describe.serial('un champ demandé avec une option', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage(DESKTOP);
    await editFields(page, async (section) => {
      // With a script, the spare row is a template « Ajouter un champ » copies.
      // Set-up, not the subject: an event rather than a pointer, which a long
      // admin page still settling on a slow runner can send elsewhere.
      await section.getByRole('button', { name: /Ajouter un champ/ }).dispatchEvent('click');
      const row = section.locator('[data-custom-row]').last();
      await row.locator('input[name="c_label"]').fill(LABEL);
      await row.locator('select[name="c_extra"]').selectOption({ label: `Avec « ${EXTRA} »` });
    });
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage(DESKTOP);
    await editFields(page, async (section) => {
      const row = section
        .locator('[data-custom-row]')
        .filter({ has: page.locator(`input[name="c_label"][value="${LABEL}"]`) });
      // The mark « Retirer » ticks, whatever state the page's script is in.
      await row.locator('[data-remove-mark]').evaluate((mark) => {
        mark.checked = true;
      });
    });
    await page.close();
  });

  test('le champ attend sa case, la suit, et n’est demandé qu’avec elle', async ({ page }) => {
    await page.goto(product);
    await settle(page);
    const form = page.locator('form[data-options-form]');
    const box = form.getByRole('checkbox', { name: new RegExp(EXTRA) });
    const field = form.getByLabel(LABEL);

    await expect(field).toBeHidden();
    await expect(field).toBeDisabled();

    await box.check();
    await expect(field).toBeVisible();
    await expect(field).toBeEnabled();
    // Required before anything is sent: an empty field stops the form here.
    expect(await field.evaluate((el) => el.required)).toBe(true);
    expect(await form.evaluate((el) => el.checkValidity())).toBe(false);
    const axe = await new AxeBuilder({ page }).include('form[data-options-form]').withTags(TAGS).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    // Unticked: out of sight, and neither sent nor required.
    await box.uncheck();
    await expect(field).toBeHidden();
    await expect(field).toBeDisabled();
    expect(await form.evaluate((el) => el.checkValidity())).toBe(true);

    // Ticked and filled: the line carries the text.
    await box.check();
    await field.fill('Léa');
    await form.getByRole('button', { name: /panier/i }).click();
    await expect(page.locator('[data-cart-count-label]')).toContainText('1');
    await page.goto('/cart');
    await expect(page.locator('main')).toContainText(new RegExp(`${LABEL}\\s*:\\s*Léa`));
  });

  test.describe('sans JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('la feuille de style montre le champ sous la case cochée, et le serveur le demande', async ({ page }) => {
      await page.goto(product);
      await settle(page);
      const form = page.locator('form[data-options-form]');
      const field = form.getByLabel(LABEL);

      await expect(field).toBeHidden();
      await form.getByRole('checkbox', { name: new RegExp(EXTRA) }).check();
      await expect(field).toBeVisible();

      // Not required in the markup, which a script would have to lift again:
      // the server refuses it, naming the field.
      await Promise.all([
        page.waitForURL((url) => url.searchParams.has('error')),
        form.getByRole('button', { name: /panier/i }).click(),
      ]);
      expect(new URL(page.url()).searchParams.get('error')).toContain(LABEL);
    });
  });
});
