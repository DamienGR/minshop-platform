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
 *
 * A thumbnail or a variant changes the photo by a fade, never by sliding past
 * the photos in between (ticket #235): the track jumps under a veil that the
 * stylesheet takes away, the address and the page stay where they are, and
 * the thumbnail of the photo on screen carries aria-current.
 */

test.skip(REMOTE || !FIXTURE.gallery, 'les photos liées aux variantes sont celles du jeu d’essai');

/**
 * The index of the photo the gallery rests on, once it has stopped moving: a
 * change of photo waits for its photo to load before the track jumps, and a
 * scroll the test sets itself snaps. Only the frames count: the veil is an
 * image laid over one of them.
 */
const resting = (page) =>
  page.locator('[data-hero-track]').evaluate(
    (track) =>
      new Promise((resolve) => {
        let last = -1;
        let still = 0;
        const timer = setInterval(() => {
          still = track.scrollLeft === last && !track.hasAttribute('aria-busy') ? still + 1 : 0;
          last = track.scrollLeft;
          if (still < 6) return;
          clearInterval(timer);
          const frames = [...track.querySelectorAll('img[id^="pi-"]')];
          resolve(frames.findIndex((img) => Math.abs(img.offsetLeft - track.scrollLeft) < 2));
        }, 50);
      }),
  );

const thumbnails = (page) => page.locator('[data-product-hero] a[href^="#pi-"]');

/**
 * From here on, every scroll position the track takes and every veil laid
 * over it, read back by `watched`.
 */
const watch = (page) =>
  page.locator('[data-hero-track]').evaluate((track) => {
    const seen = { positions: [track.scrollLeft], veils: 0 };
    window.__gallery = seen;
    track.addEventListener('scroll', () => seen.positions.push(track.scrollLeft));
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.hasAttribute('data-hero-veil')) seen.veils += 1;
        }
      }
    }).observe(track, { childList: true });
  });
const watched = (page) => page.evaluate(() => window.__gallery);

/** What a thumbnail must leave alone: the address, the history, the page. */
const where = (page) => page.evaluate(() => ({ url: location.href, history: history.length, y: scrollY }));

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

test('une vignette mène à sa photo par un fondu, sans traverser la galerie ni bouger la page', async ({ page }) => {
  await page.goto(`/products/${FIXTURE.gallery.slug}`);
  await settle(page);
  const thumbs = thumbnails(page);
  const count = await thumbs.count();
  expect(count).toBeGreaterThan(2);

  const last = thumbs.last();
  await last.scrollIntoViewIfNeeded();
  await watch(page);
  const before = await where(page);
  await last.click();

  expect(await resting(page)).toBe(count - 1);
  await expect(page.locator('[data-hero-veil]')).toHaveCount(0);
  // Two positions only, the first photo's and the last's: no photo between
  // them went by. One veil, gone once its fade ended.
  const target = await page.locator('[data-hero-track] img[id^="pi-"]').last().evaluate((img) => img.offsetLeft);
  const { positions, veils } = await watched(page);
  expect(positions.filter((x) => Math.abs(x) >= 1 && Math.abs(x - target) >= 1)).toEqual([]);
  expect(positions.some((x) => Math.abs(x - target) < 1)).toBe(true);
  expect(veils).toBe(1);
  // No #pi- in the address, no history entry, and the page did not scroll.
  expect(await where(page)).toEqual(before);
  // The thumbnail of the photo on screen says so, and only that one.
  await expect(last).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-product-hero] [aria-current]')).toHaveCount(1);

  // A swipe moves the mark too, once the track rests.
  await page.locator('[data-hero-track]').evaluate((track) => {
    track.scrollLeft = 0;
  });
  expect(await resting(page)).toBe(0);
  await expect(thumbs.first()).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-product-hero] [aria-current]')).toHaveCount(1);
});

test('une photo pas encore chargée laisse la photo affichée jusqu’à son arrivée', async ({ page }) => {
  await page.goto(`/products/${FIXTURE.gallery.slug}`);
  await settle(page);

  // The last photo, under an address no request used yet: the route holds it
  // until the test lets it go. The image route ignores the query.
  let release;
  const held = new Promise((done) => {
    release = done;
  });
  await page.route(
    (url) => url.searchParams.has('retenue'),
    async (route) => {
      await held;
      await route.continue();
    },
  );
  const frame = page.locator('[data-hero-track] img[id^="pi-"]').last();
  await frame.evaluate((img) => {
    img.removeAttribute('srcset');
    const url = new URL(img.getAttribute('src'), location.href);
    url.searchParams.set('retenue', '1');
    img.src = url.href;
  });

  const track = page.locator('[data-hero-track]');
  const thumbs = thumbnails(page);
  await thumbs.last().click();
  await expect(track).toHaveAttribute('aria-busy', 'true');
  // The waiting mark shows once the load lasts; the first photo stays under it.
  await expect(page.locator('[data-hero-wait]')).toHaveCSS('opacity', '1');
  expect(await track.evaluate((el) => el.scrollLeft)).toBe(0);
  await expect(thumbs.last()).toHaveAttribute('aria-current', 'true');

  release();
  await expect(track).not.toHaveAttribute('aria-busy');
  expect(await resting(page)).toBe((await thumbs.count()) - 1);
  await expect(page.locator('[data-hero-wait]')).toHaveCount(0);
  await expect(page.locator('[data-hero-veil]')).toHaveCount(0);
});

test('mouvement réduit : la photo change d’un coup, sans voile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/products/${FIXTURE.gallery.slug}`);
  await settle(page);
  await watch(page);

  const thumbs = thumbnails(page);
  await thumbs.last().click();
  expect(await resting(page)).toBe((await thumbs.count()) - 1);
  const target = await page.locator('[data-hero-track] img[id^="pi-"]').last().evaluate((img) => img.offsetLeft);
  const { positions, veils } = await watched(page);
  expect(positions.filter((x) => Math.abs(x) >= 1 && Math.abs(x - target) >= 1)).toEqual([]);
  expect(veils).toBe(0);
});
