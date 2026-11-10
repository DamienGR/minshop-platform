import { expect, test } from './fixtures.mjs';
import { REMOTE } from './pages.mjs';
import { signIn } from './admin.mjs';

/**
 * A Markdown field of the admin, empty: 200 px high, one line of placeholder,
 * and the cheat sheet that used to fill it behind « Aide » at the end of the
 * toolbar, in a bubble. Only a browser lays out the field the script sizes and
 * the popover it places; the markup alone says nothing about either.
 *
 * The page is serve.mjs's, emptied here and never saved, so these run on the
 * fixture store only.
 */

test.skip(REMOTE, 'la page de l’éditeur est celle du jeu d’essai');

const EDIT = '/admin/pages/page_ph0t0s0000/edit';

/** The field's height, in whole pixels. */
const heightOf = async (locator) => Math.round((await locator.boundingBox()).height);

test('un champ vide fait 200 px, grandit avec le texte et revient à 200 px', async ({ page }) => {
  await signIn(page);
  await page.goto(EDIT);

  const editor = page.locator('[data-editor]');
  await editor.fill('');
  await expect(editor).toHaveAttribute('placeholder', 'Saisissez le contenu ici…');
  // Polled: side by side, the field stands as tall as the preview, which
  // holds the fixture's photos until it has rendered the empty text.
  await expect.poll(() => heightOf(editor)).toBe(200);

  await editor.fill(Array.from({ length: 30 }, (_, i) => `Paragraphe ${i + 1}.`).join('\n\n'));
  expect(await heightOf(editor)).toBeGreaterThan(600);

  await editor.fill('');
  await expect.poll(() => heightOf(editor)).toBe(200);
});

test('« Aide » ouvre l’aide-mémoire contre son bouton, Échap et un clic ailleurs le ferment', async ({ page }) => {
  await signIn(page);
  await page.goto(EDIT);

  const editor = page.locator('[data-editor]');
  await editor.fill('');
  const button = page.getByRole('button', { name: 'Aide', exact: true });
  const bubble = page.locator('[data-syntax-help]');
  await expect(bubble).toBeHidden();

  await button.click();
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText('Aide-mémoire de la mise en forme');
  await expect(bubble).toContainText('## Un intertitre');
  await expect(bubble).toContainText('[un lien](https://example.com)');

  // Against its button, under it or above it, and whole inside the window:
  // the sheet scrolls inside the bubble when the room is short.
  const anchor = await button.boundingBox();
  const box = await bubble.boundingBox();
  const viewport = page.viewportSize();
  const under = box.y >= anchor.y + anchor.height - 1 && box.y <= anchor.y + anchor.height + 8;
  const over = box.y + box.height <= anchor.y + 1 && box.y + box.height >= anchor.y - 8;
  expect(under || over).toBe(true);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  await page.keyboard.press('Escape');
  await expect(bubble).toBeHidden();

  await button.click();
  await expect(bubble).toBeVisible();
  await editor.click();
  await expect(bubble).toBeHidden();
  // The field is the one the toolbar's buttons write in, untouched.
  await expect(editor).toHaveValue('');
});

test.describe('sans JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('l’aide s’ouvre quand même, et le champ défile au lieu de couper le texte', async ({ page }) => {
    await signIn(page);
    await page.goto(EDIT);

    // No script to grow it: the field keeps its 200 px, and a text longer
    // than that scrolls inside it rather than being cut off.
    const editor = page.locator('[data-editor]');
    expect(await heightOf(editor)).toBe(200);
    expect(await editor.evaluate((node) => getComputedStyle(node).overflowY)).toBe('auto');

    // The browser opens the popover on its own; centred, with no script to place it.
    const bubble = page.locator('[data-syntax-help]');
    await page.getByRole('button', { name: 'Aide', exact: true }).click();
    await expect(bubble).toBeVisible();
    await expect(bubble).toContainText('## Un intertitre');
    await page.keyboard.press('Escape');
    await expect(bubble).toBeHidden();
  });
});
