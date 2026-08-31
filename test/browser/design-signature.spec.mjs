import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { resolveTheme } from '../../scripts/themes.mjs';
import { settle } from './pages.mjs';

/**
 * Visual regression, as a signature of the COMPILED design rather than as a
 * pixel diff.
 *
 * The obvious implementation is `toHaveScreenshot`, and it was rejected on
 * purpose. A PNG baseline is only meaningful against the exact renderer that
 * recorded it: font hinting, subpixel positioning and GPU rasterisation all
 * differ between a laptop and a CI runner, so the baseline has to be recorded
 * inside a pinned container or the gate reports failures nobody caused. This
 * repository already spends a whole workflow measuring one flake
 * (.github/workflows/d1-flake-probe.yml); adding a second, self-inflicted one
 * to catch design drift is a bad trade.
 *
 * What actually regresses in a token-driven design is not pixels — it is a
 * token. Someone edits tokens.css and the header changes colour, or a Tailwind
 * class is dropped and a heading loses its face, or an `@source not` exclusion
 * silently removes the active theme's utilities and everything falls back to
 * browser defaults. Every one of those shows up in the COMPUTED style, which is
 * spec-defined and identical on every machine. So that is what is recorded.
 *
 * It also catches what a screenshot cannot: `check-built-css.mjs` proves the
 * theme's utilities are PRESENT in the bundle; this proves they are the ones
 * actually applied to the element.
 *
 * Re-record after a deliberate design change:
 *   THEME=<id> UPDATE_SIGNATURE=1 npm run test:browser -- design-signature
 * and read the diff like source.
 */

const theme = resolveTheme().id;
const DIR = new URL('./__signatures__/', import.meta.url);
const FILE = new URL(`${theme}.json`, DIR);

/**
 * What to look at, and where.
 *
 * Chosen so that each probe fails for one legible reason. The page's own ground
 * and text, the sticky chrome, the display face, one product caption, and the
 * primary purchase action — between them they cover every token in the required
 * `@theme` surface except the ones no element on these two pages uses.
 */
const PROBES = [
  { path: '/', name: 'page', selector: 'body' },
  { path: '/', name: 'en-tête', selector: 'header' },
  { path: '/', name: 'titre du catalogue', selector: 'main h1' },
  // The card heading is anatomy rather than a contract hook — there is no
  // `data-` marker for "the product's name in a card". It holds for the four
  // shipped designs, and a fifth that drops the list gets a failure naming this
  // probe, which is the right way to find out.
  { path: '/', name: 'nom de produit', selector: 'main ul li h2' },
  { path: '/', name: 'pied de page', selector: 'footer' },
  { path: '/products/sample-tee', name: 'nom du produit', selector: 'main h1' },
  // A real hook: [data-price-display] is part of the storefront contract, so
  // this probe cannot be broken by a redesign, only by a token change.
  { path: '/products/sample-tee', name: 'prix', selector: '[data-price-display]' },
  { path: '/products/sample-tee', name: 'action principale', selector: 'button[type="submit"]' },
  { path: '/pages/about', name: 'prose', selector: '.markdown-content p' },
  // The prose ramp itself: --prose-h1-size, its tracking, and the face.
  { path: '/pages/about', name: 'titre de prose', selector: '.markdown-content h1' },
  // The one place --color-accent lands on a real element.
  { path: '/pages/about', name: 'lien de prose', selector: '.markdown-content a' },
];

/** The properties a design is made of. Deliberately not "every computed
 *  property": layout offsets move with content, and a signature that changes
 *  when a fixture gains a product is a signature nobody trusts. */
const PROPERTIES = [
  'backgroundColor',
  'color',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'borderTopColor',
  'borderBottomColor',
  'borderBottomWidth',
  'borderRadius',
  'boxShadow',
];

async function probe(page, selector) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return null;
  return el.evaluate((node, properties) => {
    const s = getComputedStyle(node);
    return Object.fromEntries(properties.map((p) => [p, s[p]]));
  }, PROPERTIES);
}

// Desktop only. The signature is about the design's values, and recording a
// second set at a phone viewport would double the file to re-assert the same
// tokens with two font sizes.
test.describe('signature du design', () => {
  test(`le thème « ${theme} » compile le design attendu`, async ({ page }) => {
    // One viewport, checked from inside the test: a describe-level modifier
    // gets the fixtures, not the project.
    test.skip(test.info().project.name !== 'desktop', 'signature prise sur desktop');

    const captured = {};
    let current = null;
    for (const { path, name, selector } of PROBES) {
      if (current !== path) {
        await page.goto(path);
        await settle(page);
        current = path;
      }
      const style = await probe(page, selector);
      expect(style, `aucun élément pour « ${name} » (${selector}) sur ${path}`).not.toBeNull();
      captured[`${path} · ${name}`] = style;
    }

    if (process.env.UPDATE_SIGNATURE) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(FILE, `${JSON.stringify(captured, null, 2)}\n`);
      test.info().annotations.push({ type: 'signature', description: `écrite : ${FILE.pathname}` });
      return;
    }

    expect(
      existsSync(FILE),
      `aucune signature pour le thème « ${theme} ». Enregistrez-la :\n` +
        `  THEME=${theme} UPDATE_SIGNATURE=1 npm run test:browser -- design-signature`,
    ).toBe(true);

    expect(captured).toEqual(JSON.parse(readFileSync(FILE, 'utf8')));
  });
});
