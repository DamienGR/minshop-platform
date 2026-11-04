import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Catalog from '#theme/Catalog.astro';
import AltCatalog from './fixtures/catalog/AltCatalog.astro';
import { texts as fixtureTexts } from './fixtures/catalog/texts';
import { activeThemeTextSlots } from '../../src/features/themeTexts/active';
import { resolveThemeTexts, themeTextSlotProblems, validThemeTextSlots } from '../../src/features/themeTexts/slots';
import { isShippedTheme, resolveTheme } from '../../scripts/themes.mjs';
import { buildPaginationModel, buildSortModel } from '../../src/features/storefront/catalog';
import type { CatalogPageModel } from '../../src/features/storefront/models';

/**
 * The theme texts contract (ticket #165, ADR 0027): what a theme may declare,
 * and what its template receives. Every theme on disk is held to the rules —
 * the selected one or not — so a shop's broken `texts.ts` fails here rather
 * than losing a slot on the home without a word.
 */

const declarations = import.meta.glob<{ texts?: unknown }>('../../src/themes/*/texts.ts', { eager: true });

const model = (texts: CatalogPageModel['texts']): CatalogPageModel => ({
  route: 'home',
  eyebrow: 'Boutique',
  heading: 'Tout',
  categories: [],
  products: [],
  featured: null,
  texts,
  sort: buildSortModel('/', 'newest', 'desc'),
  pagination: buildPaginationModel('/', 1, 1, 'newest', 'desc'),
});

const render = async (component: unknown, value: CatalogPageModel) =>
  (await AstroContainer.create()).renderToString(component as never, { props: { model: value } });

describe('theme text declarations', () => {
  it('looks for them where the themes are', () => {
    // The glob below finds nothing when no theme declares texts; this one
    // proves the path still points at the themes, so "nothing" means nothing.
    expect(Object.keys(import.meta.glob('../../src/themes/*/Catalog.astro')).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(declarations))('%s follows the rules', (_path, module) => {
    expect(themeTextSlotProblems(module.texts)).toEqual([]);
  });

  it('accepts the documented example', () => {
    expect(themeTextSlotProblems(fixtureTexts)).toEqual([]);
  });

  it('reads the active theme’s declaration, or none', () => {
    // The theme this run selected (THEME=<id> or theme.config.json), resolved
    // by the same helper the build uses; the shipped themes declare none.
    const declared = declarations[`../../src/themes/${resolveTheme().id}/texts.ts`];
    expect(activeThemeTextSlots).toEqual(validThemeTextSlots(declared?.texts));
  });
});

describe('a template reading its texts', () => {
  it('shows the merchant’s text, else the default', async () => {
    const defaults = await render(AltCatalog, model(resolveThemeTexts(fixtureTexts, new Map())));
    expect(defaults).toContain('Né à l’atelier');
    expect(defaults).toContain('<p>Des sacs <em>cousus main</em>, un par un.</p>');

    const written = await render(
      AltCatalog,
      model(resolveThemeTexts(fixtureTexts, new Map([['hero.title', 'La carte cadeau'], ['hero.intro', '**Sur mesure**']]))),
    );
    expect(written).toContain('La carte cadeau');
    expect(written).toContain('<strong>Sur mesure</strong>');
    expect(written).not.toContain('Né à l’atelier');
  });

  it('cannot be made to inject markup through a text', async () => {
    const html = await render(
      AltCatalog,
      model(resolveThemeTexts(fixtureTexts, new Map([['hero.title', '<img src=x onerror=alert(1)>'], ['hero.intro', '<script>x</script>']]))),
    );
    expect(html).not.toMatch(/<img src=x|<script>x/);
  });

  // A shipped theme reads none; a shop's own theme may declare and read its own.
  it.skipIf(!isShippedTheme(resolveTheme().id))('leaves a theme that reads none unchanged', async () => {
    const texts = resolveThemeTexts(fixtureTexts, new Map([['hero.title', 'La carte cadeau']]));
    expect(await render(Catalog, model(texts))).toBe(await render(Catalog, model({})));
  });
});
