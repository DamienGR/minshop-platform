import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import ContentPage from '#theme/ContentPage.astro';
import AltContentPage from './fixtures/content-page/AltContentPage.astro';
import { titleMarks as fixtureMarks } from './fixtures/titles/titles';
import { activeTitleMarks } from '../../src/features/titleMarks/active';
import { titleMarkProblems, validTitleMarks } from '../../src/features/titleMarks/marks';
import { buildPageView, type PageSource } from '../../src/features/pages/view';
import { documentTitle } from '../../src/features/seo/meta';
import { llmsPageLine } from '../../src/features/seo/llms';
import { groupMenus, visibleItems, type MenuItemRow } from '../../src/features/navigation/db';
import type { ThemePageModel } from '../../src/features/storefront/models';
import { isShippedTheme, resolveTheme } from '../../scripts/themes.mjs';

/**
 * The title codes contract (ticket #251): what a theme may declare in
 * `titles.ts`, and where the core prints a page's title without them. Every
 * theme on disk is held to the rules, the selected one or not, so a shop's
 * broken declaration fails here rather than printing its codes as text.
 *
 * What the shipped themes do with a code — declare none, print it as text —
 * holds them only: a shop's own theme is where a code gets drawn, and held to
 * the same rule it would fail the moment it drew one (v0.10.2 did, on the
 * theme the ticket was written for).
 */

const declarations = import.meta.glob<{ titleMarks?: unknown }>('../../src/themes/*/titles.ts', { eager: true });
const shippedDeclarations = Object.keys(declarations).filter((path) =>
  isShippedTheme(path.split('/').at(-2) ?? ''),
);
const shipped = isShippedTheme(resolveTheme().id);

const marks = validTitleMarks(fixtureMarks);

const MARQUE: ThemePageModel = {
  key: 'marque',
  label: 'La marque',
  body: { label: 'Texte de la page' },
  zones: [
    { key: 'titre', label: 'Titre', format: 'text', maxLength: 120 },
    { key: 'texte', label: 'Texte', format: 'markdown', maxLength: 2000 },
  ],
};

const page = (overrides: Partial<PageSource> = {}): PageSource => ({
  title: 'La [feuille] marque',
  body_markdown: 'Des sacs cousus main.',
  layout: 'standard',
  model: '',
  zones: '{}',
  ...overrides,
});

const menuRow = (overrides: Partial<MenuItemRow> = {}): MenuItemRow => ({
  id: 1,
  public_id: 'nav_k7m2qx8vn6',
  location: 'header',
  target_type: 'page',
  target_id: 7,
  position: 0,
  label: null,
  target_name: 'La [feuille] marque',
  target_slug: 'la-marque',
  available: 1,
  ...overrides,
});

describe('a theme’s title codes (ticket #251)', () => {
  it('every theme on disk declares valid ones, or none', () => {
    for (const [path, module] of Object.entries(declarations)) {
      expect(titleMarkProblems(module.titleMarks), path).toEqual([]);
    }
  });

  it('the fixture declares `feuille`, and passes', () => {
    expect(titleMarkProblems(fixtureMarks)).toEqual([]);
    expect(marks).toEqual(['feuille']);
  });

  it('the shipped themes declare none', () => {
    expect(shippedDeclarations).toEqual([]);
  });

  it.skipIf(!shipped)('so nothing changes for the selected one, when it is shipped', () => {
    expect(activeTitleMarks).toEqual([]);
    const { titleText } = buildPageView(page(), [], {}, activeTitleMarks);
    expect(titleText).toBe('La [feuille] marque');
  });
});

describe('a page titled « La [feuille] marque », in a theme that declares `feuille`', () => {
  it('has « La marque — {boutique} » for its document title', () => {
    const { titleText } = buildPageView(page(), [], {}, marks);
    expect(documentTitle({ title: titleText, storeName: 'Artisagna' })).toBe('La marque — Artisagna');
  });

  it('keeps a « Titre pour Google » the merchant wrote, as written', () => {
    const { titleText } = buildPageView(page(), [], {}, marks);
    expect(documentTitle({ seoTitle: 'La [feuille] marque', title: titleText, storeName: 'Artisagna' })).toBe(
      'La [feuille] marque',
    );
  });

  it('is « La marque » in llms.txt', () => {
    expect(llmsPageLine({ title: 'La [feuille] marque', slug: 'la-marque' }, 'https://boutique.example', marks)).toBe(
      '- [La marque](https://boutique.example/pages/la-marque)',
    );
    // Without a declaration, the brackets go as before and the word stays.
    expect(llmsPageLine({ title: 'La [feuille] marque', slug: 'la-marque' }, 'https://boutique.example', [])).toBe(
      '- [La feuille marque](https://boutique.example/pages/la-marque)',
    );
  });

  it('is « La marque » in a menu without a label', () => {
    const [item] = visibleItems(groupMenus([menuRow()], null, marks).header);
    expect(item.text).toBe('La marque');
  });

  it('reaches the template as written: the theme draws the code', async () => {
    const { view } = buildPageView(page(), [], {}, marks);
    expect(view.title).toBe('La [feuille] marque');
    const container = await AstroContainer.create();
    // A shop's own ContentPage may draw the code, which is the point: only a
    // shipped one, and the fixture, are held to printing it as written.
    for (const template of shipped ? [ContentPage, AltContentPage] : [AltContentPage]) {
      const html = await container.renderToString(template as never, { props: { model: view } });
      expect(html).toContain('La [feuille] marque');
    }
  });
});

describe('a model page with an empty body, its zones holding the code', () => {
  const zones = JSON.stringify({ titre: 'Cousu [feuille] main', texte: '## Nos sacs [feuille]\n\nEn lin lavé.' });

  it('is described without the code', () => {
    const { description, view } = buildPageView(page({ model: 'marque', zones, body_markdown: '' }), [MARQUE], {}, marks);
    expect(description).toBe('Cousu main Nos sacs En lin lavé.');
    // The zones reach the template as written, like the title.
    expect(JSON.stringify(view)).toContain('Cousu [feuille] main');
  });

  it('is described as before by a theme without a declaration', () => {
    const { description } = buildPageView(page({ model: 'marque', zones, body_markdown: '' }), [MARQUE], {}, []);
    expect(description).toBe('Cousu [feuille] main Nos sacs [feuille] En lin lavé.');
  });
});
