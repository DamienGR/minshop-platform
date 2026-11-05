import { expect, test } from './fixtures.mjs';
import { FIXTURE, REMOTE, settle } from './pages.mjs';
import { ADMIN_PASSWORD } from './admin.mjs';

/**
 * A photo beside its text in a page (ticket #195): `"gauche"` or `"droite"`
 * as an image's title. The unit tests prove the renderer writes the classes;
 * only a browser applies the stylesheet, so only a browser can say where the
 * photo lands, what runs beside it, what starts below it, and that a phone
 * keeps it above its text. And the editor's two buttons are a script.
 *
 * The page is serve.mjs's, so these run on the fixture store only.
 */

test.skip(REMOTE, 'la page aux photos est celle du jeu d’essai');

/** The page box of an element, and of its first line of text. */
async function boxes(locator) {
  return locator.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
    const box = node.getBoundingClientRect();
    const line = rects[0] ?? box;
    return {
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      line: { top: line.top, left: line.left, right: line.right },
    };
  });
}

/** Where a photo, the paragraph after it and the heading after that stand. */
async function layoutOf(root) {
  const left = root.locator('.markdown-media--left img');
  const right = root.locator('.markdown-media--right img');
  return {
    left: await boxes(left),
    afterLeft: await boxes(root.locator('.markdown-media--left + p')),
    heading: await boxes(root.locator('h2').first()),
    right: await boxes(right),
    afterRight: await boxes(root.locator('.markdown-media--right + p')),
  };
}

/** Wide enough for the photos to stand beside their text (base.css). */
const wide = (page) => (page.viewportSize()?.width ?? 0) >= 640;

test('la photo se place du côté dit, le texte à côté, l’intertitre dessous', async ({ page }) => {
  await page.goto(FIXTURE.photoPage);
  await settle(page);
  const root = page.locator('.markdown-content');
  // The word never reaches the page: no tooltip reading « gauche ».
  await expect(root.locator('img[title]')).toHaveCount(0);
  const at = await layoutOf(root);

  if (wide(page)) {
    // Left: the paragraph's first line starts right of the photo, beside it.
    expect(at.afterLeft.line.left).toBeGreaterThanOrEqual(at.left.right);
    expect(at.afterLeft.line.top).toBeLessThan(at.left.bottom);
    // Right: the first line ends left of the photo.
    expect(at.afterRight.line.right).toBeLessThanOrEqual(at.right.left);
    expect(at.afterRight.line.top).toBeLessThan(at.right.bottom);
  } else {
    // A phone keeps each photo above its text.
    expect(at.afterLeft.top).toBeGreaterThanOrEqual(at.left.bottom);
    expect(at.afterRight.top).toBeGreaterThanOrEqual(at.right.bottom);
  }
  // The heading starts below the photo above it, whatever the width.
  expect(at.heading.top).toBeGreaterThanOrEqual(at.left.bottom);
  // And the article holds its last photo: nothing after it rides up beside.
  const article = await boxes(root);
  expect(article.bottom).toBeGreaterThanOrEqual(at.right.bottom);
});

test('les boutons de l’éditeur placent la photo, l’aperçu la montre, un second clic la remet', async ({ page }) => {
  await page.goto('/admin/login');
  await page.locator('input[name="password"]').fill(ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/admin/login')),
    page.locator('button[type="submit"]').click(),
  ]);
  await page.goto('/admin/pages/page_ph0t0s0000/edit');

  const editor = page.locator('[data-editor]');
  const image = '![Mes mains](/images/media/tee-front.jpg)';
  await editor.fill(`${image}\n\nLe texte qui l’accompagne, assez long pour courir à côté de la photo sur deux lignes au moins.`);

  // Away from any image, the button says what to do and changes nothing.
  await editor.evaluate((field) => field.setSelectionRange(field.value.length, field.value.length));
  // Answered from the listener: an alert left open blocks the click itself.
  const said = [];
  page.once('dialog', (dialog) => {
    said.push(dialog.message());
    dialog.dismiss();
  });
  await page.getByRole('button', { name: 'À gauche' }).click();
  await expect.poll(() => said).toEqual(['Placez d’abord le curseur sur la ligne d’une image.']);
  await expect(editor).toHaveValue(new RegExp(`^${image.replace(/[[\]()!.]/g, '\\$&')}\\n`));

  await editor.evaluate((field) => field.setSelectionRange(3, 3));
  await page.getByRole('button', { name: 'À gauche' }).click();
  await expect(editor).toHaveValue(/^!\[Mes mains\]\(\/images\/media\/tee-front\.jpg "gauche"\)\n/);

  // The preview goes through the same renderer and stylesheet.
  const preview = page.locator('[data-preview]');
  if (await preview.isVisible()) {
    await expect(preview.locator('.markdown-media--left img')).toBeVisible();
    if (wide(page)) {
      const photo = await boxes(preview.locator('.markdown-media--left img'));
      const text = await boxes(preview.locator('.markdown-media--left + p'));
      expect(text.line.left).toBeGreaterThanOrEqual(photo.right);
    }
  }

  // The image stays selected, so a second press finds it and undoes the first.
  await page.getByRole('button', { name: 'À gauche' }).click();
  await expect(editor).toHaveValue(/^!\[Mes mains\]\(\/images\/media\/tee-front\.jpg\)\n/);
  await page.getByRole('button', { name: 'À droite' }).click();
  await expect(editor).toHaveValue(/^!\[Mes mains\]\(\/images\/media\/tee-front\.jpg "droite"\)\n/);
});
