import { expect, test } from './fixtures.mjs';
import { FIXTURE, REMOTE, settle } from './pages.mjs';

/**
 * The product page's gallery follows the shopper, never the server's default
 * (ticket #185). The variant checked on load is the first in stock, not a
 * choice: the page used to slide from the merchant's first photo to that
 * variant's, away from the one image loaded eagerly. serve.mjs links
 * sample-tee's default (Small) to the SECOND photo and Medium to the third.
 *
 * Only a browser runs the script, and only a browser hands a form back on
 * Back: Chromium does it at pageshow, after the script has read the form.
 */

test.skip(REMOTE || !FIXTURE.gallery, 'les photos liées aux variantes sont celles du jeu d’essai');

/**
 * The index of the photo the gallery rests on, once it has stopped moving:
 * the track scrolls smoothly, which no getAnimations() reports.
 */
const resting = (page) =>
  page.locator('[data-hero-track]').evaluate(
    (track) =>
      new Promise((resolve) => {
        let last = -1;
        let still = 0;
        const timer = setInterval(() => {
          still = track.scrollLeft === last ? still + 1 : 0;
          last = track.scrollLeft;
          if (still < 6) return;
          clearInterval(timer);
          const images = [...track.querySelectorAll('img')];
          resolve(images.findIndex((img) => Math.abs(img.offsetLeft - track.scrollLeft) < 2));
        }, 50);
      }),
  );

const price = (page) => page.locator('[data-price-display]');

test('la fiche s’ouvre sur la première photo, même quand la variante cochée en a une autre', async ({ page }) => {
  await page.goto(`/products/${FIXTURE.gallery.slug}`);
  await settle(page);
  await expect(page.getByRole('radio', { name: /Small/ })).toBeChecked();
  expect(await resting(page)).toBe(0);
  await expect(price(page)).toHaveText(/24,00/);
});

test('la galerie suit la variante choisie, pas une option cochée', async ({ page }) => {
  await page.goto(`/products/${FIXTURE.gallery.slug}`);
  await settle(page);

  await page.getByRole('radio', { name: /Medium/ }).check();
  expect(await resting(page)).toBe(2);
  await expect(price(page)).toHaveText(/26,00/);

  // The shopper goes back to the first photo, then ticks an add-on: the
  // price moves, the photo stays.
  await page.locator('[data-hero-track]').evaluate((track) => {
    track.scrollLeft = 0;
  });
  expect(await resting(page)).toBe(0);
  await page.getByRole('checkbox', { name: /Gift wrap/ }).check();
  await expect(price(page)).toHaveText(/31,00/);
  expect(await resting(page)).toBe(0);

  // Choosing the default back is a choice: its photo comes.
  await page.getByRole('radio', { name: /Small/ }).check();
  expect(await resting(page)).toBe(1);
});

test('au retour arrière, le prix et la photo sont ceux de la variante choisie', async ({ page }) => {
  await page.goto(`/products/${FIXTURE.gallery.slug}`);
  await settle(page);
  await page.getByRole('radio', { name: /Medium/ }).check();
  expect(await resting(page)).toBe(2);

  await page.goto('/cart');
  await page.goBack();
  await settle(page);
  await expect(page.getByRole('radio', { name: /Medium/ })).toBeChecked();
  await expect(price(page)).toHaveText(/26,00/);
  expect(await resting(page)).toBe(2);
});
