import { expect, test } from './fixtures.mjs';
import { FIXTURE, REMOTE, settle } from './pages.mjs';
import { signIn } from './admin.mjs';

/**
 * Text in columns in a page (a `::: colonnes` block, ADR 0030). The unit tests
 * prove the renderer writes the blocks and their classes; only a browser
 * applies the stylesheet, so only a browser can say the columns stand side by
 * side in the proportions asked, and one under the other on a phone. And the
 * editor's « Colonnes » button is a script.
 *
 * The page is serve.mjs's, so these run on the fixture store only.
 */

test.skip(REMOTE, 'la page en colonnes est celle du jeu d’essai');

/** Wide enough for the columns to stand side by side (base.css). */
const wide = (page) => (page.viewportSize()?.width ?? 0) >= 640;

/** The page box of each column of a block. */
async function columnsOf(block) {
  return block.evaluate((node) =>
    [...node.querySelectorAll(':scope > .markdown-column')].map((column) => {
      const { top, bottom, left, right, width } = column.getBoundingClientRect();
      return { top, bottom, left, right, width };
    }),
  );
}

test('les colonnes se tiennent côte à côte dans les proportions dites, l’une sous l’autre sur téléphone', async ({
  page,
}) => {
  await page.goto(FIXTURE.columnsPage);
  await settle(page);
  const blocks = page.locator('.markdown-content .markdown-columns');
  await expect(blocks).toHaveCount(2);
  const [a, b] = await columnsOf(blocks.nth(0));
  const [c, d, e] = await columnsOf(blocks.nth(1));

  if (wide(page)) {
    // One narrow, one twice as wide, on one line.
    expect(Math.abs(a.top - b.top)).toBeLessThanOrEqual(1);
    expect(b.left).toBeGreaterThan(a.right);
    expect(b.width / a.width).toBeGreaterThan(1.9);
    expect(b.width / a.width).toBeLessThan(2.1);
    // Three equal ones.
    for (const column of [d, e]) {
      expect(Math.abs(column.top - c.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(column.width - c.width)).toBeLessThanOrEqual(1);
    }
    expect(e.left).toBeGreaterThan(d.right);
  } else {
    // In the order they were written, each as wide as the text.
    expect(b.top).toBeGreaterThanOrEqual(a.bottom);
    expect(Math.abs(b.width - a.width)).toBeLessThanOrEqual(1);
    expect(d.top).toBeGreaterThanOrEqual(c.bottom);
    expect(e.top).toBeGreaterThanOrEqual(d.bottom);
  }
});

test('le bouton « Colonnes » écrit un bloc de deux colonnes, que l’aperçu montre', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/pages/page_c0nnes0000/edit');
  const editor = page.locator('[data-editor]');
  await editor.fill('Intro.');
  await editor.press('End');
  await page.locator('[data-toolbar] [data-tool="block"]', { hasText: 'Colonnes' }).click();

  await expect(editor).toHaveValue(
    [
      'Intro.',
      '',
      '::: colonnes',
      'Le texte de la première colonne.',
      '',
      '::: colonne',
      'Le texte de la deuxième colonne.',
      ':::',
      '',
    ].join('\n'),
  );
  // The first sample comes selected: typing replaces it.
  const selected = await editor.evaluate((field) => field.value.slice(field.selectionStart, field.selectionEnd));
  expect(selected).toBe('Le texte de la première colonne.');

  const preview = page.locator('[data-preview]');
  test.skip(!(await preview.isVisible()), 'aperçu replié à cette largeur');
  const block = preview.locator('.markdown-columns');
  await expect(block.locator('.markdown-column')).toHaveCount(2);
  await expect(preview.locator('.markdown-block-error')).toHaveCount(0);
});

test('l’aperçu dit ce qui ne va pas dans un bloc de colonnes', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/pages/page_c0nnes0000/edit');
  const preview = page.locator('[data-preview]');
  test.skip(!(await preview.isVisible()), 'aperçu replié à cette largeur');
  await page.locator('[data-editor]').fill(['::: colonnes', 'Une seule.', ':::'].join('\n'));
  await expect(preview.locator('.markdown-block-error')).toContainText('une seule colonne');
  await expect(preview.locator('.markdown-column')).toHaveText('Une seule.');
});
