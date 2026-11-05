import { expect, test } from './fixtures.mjs';
import { FIXTURE, REMOTE, settle } from './pages.mjs';
import { signIn } from './admin.mjs';

/**
 * A row of photos in a page, and a photo alone (ticket #194). The unit tests
 * prove the renderer marks the row; only a browser applies the stylesheet, so
 * only a browser can say the photos stand side by side, share one shape, go
 * two to a line on a phone, and that a portrait alone stops short of the
 * screen's height without being squashed. And the lightbox that opens a
 * row's photo large (ticket #205) is a script and a dialog.
 *
 * The page is serve.mjs's, so these run on the fixture store only.
 */

test.skip(REMOTE, 'la page aux photos est celle du jeu d’essai');

/**
 * Every photo under `root` loaded. A body image is lazy, so `load` does not
 * wait for it, and one below the fold loads only once scrolled to; the row
 * keeps its room without its bitmap, but a photo's own proportions are only
 * known once it is there.
 */
async function photosLoaded(root) {
  for (const photo of await root.locator('img').all()) {
    await photo.scrollIntoViewIfNeeded();
    await expect.poll(() => photo.evaluate((img) => img.complete && img.naturalHeight > 0)).toBe(true);
  }
}

/** Wide enough for the whole row to stand on one line (base.css). */
const wide = (page) => (page.viewportSize()?.width ?? 0) >= 640;

/** The page box of each image of a row, and of the row itself. */
async function rowOf(row) {
  return row.evaluate((node) => {
    const box = (el) => {
      const { top, bottom, left, right, width, height } = el.getBoundingClientRect();
      return { top, bottom, left, right, width, height };
    };
    return { row: box(node), images: [...node.querySelectorAll('img')].map(box) };
  });
}

/** Asserts what a row looks like at this width: the photos' shape and lines. */
function expectRow({ row, images }, isWide) {
  expect(images).toHaveLength(3);
  for (const image of images) {
    // One shape for all: square, whatever the photo's own proportions.
    expect(Math.abs(image.width - image.height)).toBeLessThanOrEqual(1);
    expect(image.left).toBeGreaterThanOrEqual(row.left - 1);
    expect(image.right).toBeLessThanOrEqual(row.right + 1);
  }
  const [a, b, c] = images;
  expect(Math.abs(a.top - b.top)).toBeLessThanOrEqual(1);
  expect(b.left).toBeGreaterThan(a.right);
  if (isWide) {
    // The whole row on one line, across the measure.
    expect(Math.abs(c.top - a.top)).toBeLessThanOrEqual(1);
    expect(c.left).toBeGreaterThan(b.right);
    expect(c.right).toBeGreaterThan(row.right - 2);
  } else {
    // Two to a line, the third below, centred.
    expect(c.top).toBeGreaterThan(a.bottom);
    const middle = (row.left + row.right) / 2;
    expect(Math.abs((c.left + c.right) / 2 - middle)).toBeLessThanOrEqual(2);
  }
}

test('des photos l’une sous l’autre font une rangée, au même format', async ({ page }) => {
  await page.goto(FIXTURE.galleryPage);
  await settle(page);
  const row = page.locator('.markdown-content .markdown-gallery');
  await expect(row).toHaveCount(1);
  await photosLoaded(row);
  expectRow(await rowOf(row), wide(page));
});

test('une photo seule garde sa forme et ne dépasse pas la hauteur de l’écran', async ({ page }) => {
  await page.goto(FIXTURE.galleryPage);
  await settle(page);
  const photo = page.locator('.markdown-content .markdown-media img');
  await photosLoaded(page.locator('.markdown-content .markdown-media'));
  const at = await photo.evaluate((img) => {
    const box = img.getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return {
      width: box.width,
      height: box.height,
      // Reserved before the bytes arrive: the attributes are the media row's.
      reserved: img.getAttribute('width') === '900' && img.getAttribute('height') === '1200',
      natural: img.naturalWidth / img.naturalHeight,
      fit: getComputedStyle(img).objectFit,
      cap: Math.min(window.innerHeight * 0.8, 42 * rem),
    };
  });
  expect(at.reserved).toBe(true);
  expect(at.height).toBeLessThanOrEqual(at.cap + 1);
  // Not squashed: either the box keeps the photo's proportions, or the photo
  // is drawn whole inside it.
  if (Math.abs(at.width / at.height - at.natural) > 0.01) expect(at.fit).toBe('contain');
});

test('l’aperçu de l’éditeur montre la rangée', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/pages/page_ga11ery000/edit');

  const preview = page.locator('[data-preview]');
  test.skip(!(await preview.isVisible()), 'aperçu replié à cette largeur');
  const editor = page.locator('[data-editor]');
  await editor.fill(
    ['tee-front.jpg', 'tee-back.jpg', 'tee-side.jpg']
      .map((key) => `![Photo](/images/media/${key})`)
      .join('\n'),
  );
  const row = preview.locator('.markdown-gallery');
  await expect(row.locator('img')).toHaveCount(3);
  await photosLoaded(row);
  // The preview pane is narrower than the page: the row follows the
  // viewport's breakpoint, not the pane's, so only its line is asserted here.
  const { images } = await rowOf(row);
  expect(Math.abs(images[0].top - images[1].top)).toBeLessThanOrEqual(1);
  expect(Math.abs(images[0].width - images[0].height)).toBeLessThanOrEqual(1);
});

/** The lightbox, its photo and the position it announces. */
const lightboxOf = (page) => {
  const dialog = page.locator('[data-page-lightbox]');
  return { dialog, image: dialog.locator('img'), position: dialog.locator('[data-lightbox-position]') };
};

test('un clic sur une photo de la rangée l’ouvre en grand, et le clavier y circule', async ({ page }) => {
  await page.goto(FIXTURE.galleryPage);
  await settle(page);
  const links = page.locator('.markdown-content .markdown-gallery a[data-lightbox]');
  await expect(links).toHaveCount(3);
  const { dialog, image, position } = lightboxOf(page);
  await expect(dialog).toBeHidden();

  await links.nth(1).click();
  await expect(dialog).toBeVisible();
  await expect(image).toHaveAttribute('src', /\/media\/tee-back\.jpg$/);
  await expect(image).toHaveAttribute('alt', 'Le dos');
  await expect(dialog.locator('figcaption')).toHaveText('Le dos');
  await expect(position).toHaveText('Photo 2 sur 3');
  // Modal: the focus is in the dialog, and the photo is whole on the screen.
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await expect.poll(() => image.evaluate((img) => img.complete && img.naturalHeight > 0)).toBe(true);
  const box = await image.evaluate((img) => {
    const { top, left, bottom, right } = img.getBoundingClientRect();
    return { top, left, bottom, right, width: window.innerWidth, height: window.innerHeight };
  });
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(box.height);
  expect(box.right).toBeLessThanOrEqual(box.width);

  await page.keyboard.press('ArrowRight');
  await expect(image).toHaveAttribute('src', /\/media\/tee-side\.jpg$/);
  await expect(position).toHaveText('Photo 3 sur 3');
  // Past the last photo, the first: the row goes round.
  await page.keyboard.press('ArrowRight');
  await expect(image).toHaveAttribute('src', /\/media\/tee-front\.jpg$/);
  await dialog.getByRole('button', { name: 'Photo précédente' }).click();
  await expect(image).toHaveAttribute('src', /\/media\/tee-side\.jpg$/);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // Back to the photo that opened it, not to the top of the page.
  await expect(links.nth(1)).toBeFocused();
});

test('la photo agrandie se ferme par son bouton ou par un clic à côté', async ({ page }) => {
  await page.goto(FIXTURE.galleryPage);
  await settle(page);
  const link = page.locator('.markdown-content .markdown-gallery a[data-lightbox]').first();
  const { dialog } = lightboxOf(page);

  await link.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toBeHidden();

  await link.click();
  await expect(dialog).toBeVisible();
  // The top of the dialog, above the photo, is the dialog itself.
  const width = page.viewportSize()?.width ?? 0;
  await page.mouse.click(width / 2, 8);
  await expect(dialog).toBeHidden();
});

test('une page sans rangée ne charge pas la lightbox', async ({ page }) => {
  await page.goto(FIXTURE.photoPage);
  await settle(page);
  await expect(page.locator('.markdown-content img').first()).toBeVisible();
  await expect(page.locator('[data-page-lightbox]')).toHaveCount(0);
  await expect(page.locator('.markdown-content a[data-lightbox]')).toHaveCount(0);
});

test.describe('sans JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('un clic sur une photo de la rangée ouvre la photo', async ({ page }) => {
    await page.goto(FIXTURE.galleryPage);
    await page.locator('.markdown-content .markdown-gallery a[data-lightbox]').nth(1).click();
    await expect(page).toHaveURL(/\/images\/media\/tee-back\.jpg$/);
  });
});

test('dans l’aperçu, plus de quatre photos passent à la ligne, et un clic reste dans l’éditeur', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/pages/page_ga11ery000/edit');

  const preview = page.locator('[data-preview]');
  test.skip(!(await preview.isVisible()), 'aperçu replié à cette largeur');
  const editor = page.locator('[data-editor]');
  const keys = ['tee-front.jpg', 'tee-back.jpg', 'tee-side.jpg', 'portrait.png', 'tee-front.jpg'];
  await editor.fill(keys.map((key) => `![Photo](/images/media/${key})`).join('\n'));
  const row = preview.locator('.markdown-gallery');
  await expect(row.locator('img')).toHaveCount(5);
  await photosLoaded(row);
  const { images } = await rowOf(row);
  if (wide(page)) {
    // Four to a line, the fifth below, centred.
    for (const image of images.slice(1, 4)) expect(Math.abs(image.top - images[0].top)).toBeLessThanOrEqual(1);
    expect(images[4].top).toBeGreaterThan(images[0].bottom);
  }

  const url = page.url();
  await row.locator('img').nth(1).click();
  // The click selects the photo's line; it does not follow its link.
  expect(page.url()).toBe(url);
  await expect(page.locator('[data-page-lightbox]')).toHaveCount(0);
});
