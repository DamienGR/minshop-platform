import { expect, test } from './fixtures.mjs';
import { FIXTURE, REMOTE, settle } from './pages.mjs';
import { signIn } from './admin.mjs';

/**
 * A box in a page (a `::: encadré` block, ticket #205). The unit tests prove
 * the renderer writes the block and its class; only a browser applies the
 * stylesheet, so only a browser can say the box stands apart from the page,
 * in its theme's colours, and keeps to its column. And the editor's
 * « Encadré » button is a script.
 *
 * The page is serve.mjs's, so these run on the fixture store only. The
 * contrast of its text is a11y.spec.mjs's, which walks the same page.
 */

test.skip(REMOTE, 'la page à encadré est celle du jeu d’essai');

const EDIT = '/admin/pages/page_encadre000/edit';
const button = (page) => page.locator('[data-toolbar] [data-tool="enclose"]', { hasText: 'Encadré' });
const selection = (editor) =>
  editor.evaluate((field) => field.value.slice(field.selectionStart, field.selectionEnd));

test('l’encadré se détache de la page et tient dans sa colonne', async ({ page }) => {
  await page.goto(FIXTURE.boxPage);
  await settle(page);
  const boxes = page.locator('.markdown-content .markdown-box');
  await expect(boxes).toHaveCount(2);
  await expect(boxes.first().locator('h3')).toHaveText('Bon à savoir');
  await expect(boxes.first().locator('li')).toHaveCount(2);

  const look = await boxes.first().evaluate((box) => {
    const style = getComputedStyle(box);
    const paper = getComputedStyle(document.body).backgroundColor;
    return {
      background: style.backgroundColor,
      paper,
      start: parseFloat(style.borderInlineStartWidth),
      edge: parseFloat(style.borderTopWidth),
    };
  });
  // On the theme's raised surface, marked on its starting edge.
  expect(look.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(look.background).not.toBe(look.paper);
  expect(look.start).toBe(3);
  expect(look.edge).toBe(1);

  // The box of the second column keeps inside it, whatever the width.
  const fits = await page
    .locator('.markdown-columns .markdown-column')
    .nth(1)
    .evaluate((column) => {
      const box = column.querySelector('.markdown-box');
      if (!box) return null;
      const outer = column.getBoundingClientRect();
      const inner = box.getBoundingClientRect();
      return inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5;
    });
  expect(fits).toBe(true);
});

test('le bouton « Encadré » encadre les lignes choisies, entières', async ({ page }) => {
  await signIn(page);
  await page.goto(EDIT);
  const editor = page.locator('[data-editor]');
  await editor.fill(['Intro.', '', 'La livraison est offerte.', 'Dès 60 €.', '', 'Fin.'].join('\n'));
  // From the middle of one line to the middle of the next.
  await editor.evaluate((field) => {
    const start = field.value.indexOf('livraison');
    field.setSelectionRange(start, field.value.indexOf('60'));
  });
  await button(page).click();

  await expect(editor).toHaveValue(
    ['Intro.', '', '::: encadré', 'La livraison est offerte.', 'Dès 60 €.', ':::', '', 'Fin.'].join('\n'),
  );
  expect(await selection(editor)).toBe('La livraison est offerte.\nDès 60 €.');

  const preview = page.locator('[data-preview]');
  test.skip(!(await preview.isVisible()), 'aperçu replié à cette largeur');
  // The stored page's two boxes give way to the draft's one.
  await expect(preview.locator('.markdown-box')).toHaveCount(1);
  await expect(preview.locator('.markdown-box p')).toHaveText('La livraison est offerte.\nDès 60 €.');
  await expect(preview.locator('.markdown-block-error')).toHaveCount(0);
});

test('sans sélection, le bouton « Encadré » insère un exemple à remplacer', async ({ page }) => {
  await signIn(page);
  await page.goto(EDIT);
  const editor = page.locator('[data-editor]');
  await editor.fill('Intro.');
  await editor.press('End');
  await button(page).click();

  await expect(editor).toHaveValue(['Intro.', '', '::: encadré', 'Le texte à mettre en avant.', ':::', ''].join('\n'));
  // The sample comes selected: typing replaces it.
  expect(await selection(editor)).toBe('Le texte à mettre en avant.');
  await page.keyboard.type('Ouvert le dimanche.');
  await expect(editor).toHaveValue(['Intro.', '', '::: encadré', 'Ouvert le dimanche.', ':::', ''].join('\n'));
});

test('l’aperçu dit qu’un encadré n’est pas fermé', async ({ page }) => {
  await signIn(page);
  await page.goto(EDIT);
  const preview = page.locator('[data-preview]');
  test.skip(!(await preview.isVisible()), 'aperçu replié à cette largeur');
  await page.locator('[data-editor]').fill(['::: encadré', 'Sans fin.'].join('\n'));
  await expect(preview.locator('.markdown-block-error')).toContainText('n’est pas fermé');
  await expect(preview.locator('.markdown-box')).toHaveText('Sans fin.');
});
