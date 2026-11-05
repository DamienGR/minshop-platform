import { expect, test } from './fixtures.mjs';
import { REMOTE } from './pages.mjs';
import { signIn } from './admin.mjs';

/**
 * The page editor's toolbar stays at the top of the window down a long page
 * (ticket #203). The field grows with its text and the page scrolls, so the
 * tools would otherwise be a scroll back up away. Only a browser lays out a
 * sticky box: an `overflow: hidden` on any box between it and the window is
 * enough to make it scroll away like any other, every unit test green.
 *
 * The page is serve.mjs's, filled here and never saved, so these run on the
 * fixture store only.
 */

test.skip(REMOTE, 'la page de l’éditeur est celle du jeu d’essai');

/** Eighty paragraphs: far longer than any window the suite opens. */
const LONG = Array.from(
  { length: 80 },
  (_, i) => `Paragraphe ${i + 1}, assez long pour tenir sur une ligne de l’éditeur.`,
).join('\n\n');

test('la barre d’outils reste en haut de l’écran le long d’une longue page', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/pages/page_ph0t0s0000/edit');

  const editor = page.locator('[data-editor]');
  const toolbar = page.locator('[data-toolbar]');
  await editor.fill(LONG);

  // At rest, it stands in its place, right above the field.
  const rest = await toolbar.boundingBox();
  const field = await editor.boundingBox();
  expect(rest.y).toBeGreaterThan(0);
  expect(rest.y + rest.height).toBeLessThanOrEqual(field.y + 1);

  // Down at the end of the text: the field's last line at the window's bottom.
  // Not the end of the document, which on a phone is the preview, stacked
  // under the field: the toolbar leaves with its pane, as it should.
  await editor.evaluate((node) => {
    const box = node.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + box.bottom - window.innerHeight);
  });
  await expect.poll(async () => Math.round((await toolbar.boundingBox()).y)).toBe(0);
  expect((await editor.boundingBox()).y).toBeLessThan(0);
  await expect(page.getByRole('button', { name: 'H2' })).toBeInViewport();

  // Over the text, and opaque: the text scrolls under it, not through it.
  const painted = await toolbar.evaluate((bar) => {
    const box = bar.getBoundingClientRect();
    const hit = document.elementFromPoint(box.right - 2, box.top + 2);
    return { onTop: bar.contains(hit), background: getComputedStyle(bar).backgroundColor };
  });
  expect(painted.onTop).toBe(true);
  expect(painted.background).not.toBe('rgba(0, 0, 0, 0)');

  // And it works from there: the last paragraph becomes a heading, and the
  // page stays where it is.
  await editor.evaluate((node) => {
    const start = node.value.lastIndexOf('\n') + 1;
    node.setSelectionRange(start, start);
  });
  const scrolled = await page.evaluate(() => window.scrollY);
  await page.getByRole('button', { name: 'H2' }).click();
  await expect(editor).toHaveValue(/\n## Paragraphe 80,[^\n]*$/);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled - 50);
  expect(Math.round((await toolbar.boundingBox()).y)).toBe(0);
});
