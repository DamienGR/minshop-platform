import { expect, test } from '@playwright/test';
import { ROUTES, overflowOf, settle } from './pages.mjs';

/**
 * Nothing scrolls sideways — the "responsive" line of the jalon-5 deliverables.
 *
 * A horizontal scrollbar on a storefront is not a cosmetic fault. On a phone it
 * makes the page drift under the thumb while reading, and it usually means one
 * element is wider than the viewport and has quietly pushed a control off the
 * right edge, where nobody will find it. The measurement is exact, so the
 * assertion is exact: zero.
 *
 * Both projects run this, so every route is measured at a desktop viewport and
 * at a phone's.
 */
for (const { name, path } of ROUTES) {
  test(`${name} ne déborde pas horizontalement`, async ({ page }) => {
    await page.goto(path);
    await settle(page);

    expect(await overflowOf(page)).toBe(0);
  });
}

/**
 * Browser zoom, at the bar the plan sets: 200 %.
 *
 * Zoom does not scale the viewport — it shrinks the CSS-pixel width the page is
 * laid out in — so halving the width IS 200 % zoom, and it is far steadier than
 * driving Chromium's zoom over CDP.
 *
 * WCAG 1.4.10 (Reflow, AA) actually asks for 320 CSS px, which is 400 % on a
 * 1280 desktop and also an iPhone SE. That is deliberately NOT gated here, and
 * the reason is written down in the jalon-5 État: the `default` theme fails it
 * by 37 px — its header nav carries a disclosure, a search link and the cart
 * with nothing that can shrink — and choosing which of those gives way at
 * 320 px is a design decision for whoever owns that theme, not something to
 * settle inside a test. `atelier` passes 320 px today; a gate the shipped
 * default cannot meet would be turned off within a week.
 */
for (const [label, width] of [['200 %', 640]]) {
  test(`le catalogue reste lisible à ${label} de zoom`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto('/');
    await settle(page);

    expect(await overflowOf(page)).toBe(0);
    // Reflow, not just "no scrollbar": the products must still be there. A
    // template that hid the grid below a breakpoint would pass the first line.
    // Scoped to <main>: the header's merchant nav can legitimately link to a
    // product and legitimately collapse into the disclosure at this width.
    await expect(page.locator('main a[href^="/products/"]').first()).toBeVisible();
  });
}

test('un nom de boutique très long ne fait pas déborder l’en-tête', async ({ page }) => {
  await page.goto('/');
  await settle(page);

  // The seeded shop is called "Ma boutique", which fits everywhere and proves
  // nothing. A real merchant is called "Atelier de céramique de Haute-Provence",
  // and the header wordmark is a flex item — flex items default to
  // min-width:auto, so one that cannot shrink pushes the cart off the right
  // edge at phone width. Injected rather than seeded: what is under test is the
  // theme's CSS, and the store name is a runtime setting, not a fixture shape.
  await page.evaluate(() => {
    const mark = document.querySelector('header a[href="/"]');
    const text = mark?.querySelector('span') ?? mark;
    if (text) text.textContent = 'Atelier de céramique de Haute-Provence';
  });

  expect(await overflowOf(page)).toBe(0);
});

test('un nom de produit très long ne fait pas déborder sa vignette', async ({ page }) => {
  await page.goto('/');
  await settle(page);

  // Injected rather than seeded: the fixture is shared with the HTML baselines,
  // and what is under test here is the theme's CSS — whether the caption row
  // survives a name that cannot fit beside a price — not the server's ability
  // to store a long string. The container contract covers that half.
  await page.evaluate(() => {
    const heading = document.querySelector('main h2');
    if (heading) {
      heading.textContent =
        'Torchon en lin lavé, tissé et ourlé à la main dans le Nord de la France, très grand format';
    }
  });

  expect(await overflowOf(page)).toBe(0);
});
