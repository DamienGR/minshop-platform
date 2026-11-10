import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Catalog from '#theme/Catalog.astro';
import Header from '#theme/Header.astro';
import Footer from '#theme/Footer.astro';
import ProductDetail from '#theme/ProductDetail.astro';
import AltCatalog from './fixtures/catalog/AltCatalog.astro';
import AltHeader from './fixtures/shell/AltHeader.astro';
import AltFooter from './fixtures/shell/AltFooter.astro';
import AltProductDetail from './fixtures/product-detail/AltProductDetail.astro';
import { texts as fixtureTexts } from './fixtures/catalog/texts';
import { activeThemeTextSlots } from '../../src/features/themeTexts/active';
import { resolveThemeTexts, themeTextSlotProblems, validThemeTextSlots } from '../../src/features/themeTexts/slots';
import { isShippedTheme, resolveTheme } from '../../scripts/themes.mjs';
import { buildPaginationModel, buildSortModel } from '../../src/features/storefront/catalog';
import { buildShellModel } from '../../src/features/storefront/shell';
import type {
  CatalogPageModel,
  ProductDetailModel,
  ProductPurchaseModel,
  StorefrontShellModel,
  ThemeText,
} from '../../src/features/storefront/models';

/**
 * The theme texts contract (tickets #165, #225, ADR 0027): what a theme may
 * declare, and what its templates receive — the home, the header and footer,
 * the product page. Every theme on disk is held to the rules — the selected
 * one or not — so a shop's broken `texts.ts` fails here rather than losing a
 * slot without a word.
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

const shell = (texts: Record<string, ThemeText>): StorefrontShellModel =>
  buildShellModel({
    storeName: 'Atelier',
    logoImageKey: null,
    imageBaseUrl: '',
    announcement: '',
    announcementHref: '',
    headerItems: [],
    footerItems: [],
    searchQuery: '',
    cartEnabled: true,
    accountsEnabled: false,
    texts,
  });

const detail = (texts: Record<string, ThemeText>): ProductDetailModel => ({
  id: 'prod_k7m2qx8vn6',
  name: 'Sac Bouillac',
  href: '/products/sac-bouillac',
  description: null,
  descriptionHtml: null,
  formattedPrice: '49,00 €',
  priceCents: 4900,
  currency: 'eur',
  priceVaries: false,
  soldOut: false,
  lowStock: false,
  digitalDelivery: false,
  tags: [],
  categories: [],
  images: [],
  heroImage: { src: '/images/sac.jpg', alt: 'Sac Bouillac', priority: true },
  related: [],
  backHref: '/',
  error: null,
  texts,
});

const purchase: ProductPurchaseModel = {
  productId: 'prod_k7m2qx8vn6',
  cartAction: '/api/cart',
  expressAction: '/express',
  hasOptions: false,
  soldOut: false,
  showAddToCart: true,
  showBuyNow: false,
  variantLabel: null,
  variants: [],
  extras: [],
  customFields: [],
};

/** Any template, with the props it takes. */
const renderWith = async (component: unknown, props: Record<string, unknown>) =>
  (await AstroContainer.create()).renderToString(component as never, { props });

const written = (entries: Array<[string, string]>) => resolveThemeTexts(fixtureTexts, new Map(entries));

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

// Ticket #225: the same texts reach the header and footer, on every route the
// shell wraps (/checkout and /pay included: it is built from what middleware
// read), and the product page.
describe('the shell and the product page reading their texts', () => {
  it('show the merchant’s text in the header and the footer, else the default', async () => {
    const defaults = shell(written([]));
    expect(await renderWith(AltHeader, { model: defaults })).toContain('Expédié sous 3 à 5 jours');
    expect(await renderWith(AltFooter, { model: defaults })).toContain('Paiement sécurisé');

    const model = shell(
      written([
        ['bar.shipping', 'Point relais dès 3,90\u00a0€, offert dès 50\u00a0€'],
        ['pledge.payment', 'Paiement par carte ou par virement'],
      ]),
    );
    const header = await renderWith(AltHeader, { model });
    expect(header).toContain('Point relais dès 3,90\u00a0€, offert dès 50\u00a0€');
    expect(header).not.toContain('Expédié sous 3 à 5 jours');
    expect(await renderWith(AltFooter, { model })).toContain('Paiement par carte ou par virement');
  });

  it('show the merchant’s text on the product page, else the default', async () => {
    const defaults = await renderWith(AltProductDetail, { model: detail(written([])), purchase });
    expect(defaults).toContain('Prix TTC, frais de port en sus');
    expect(defaults).toContain('<p>Expédié sous <em>3 à 5 jours</em>.</p>');

    const html = await renderWith(AltProductDetail, {
      model: detail(
        written([
          ['product.priceNote', 'Prix TTC, livraison dès 3,90\u00a0€'],
          ['product.delivery', 'En **point relais**, offert dès 50\u00a0€.'],
        ]),
      ),
      purchase,
    });
    expect(html).toContain('Prix TTC, livraison dès 3,90\u00a0€');
    expect(html).toContain('<strong>point relais</strong>');
    expect(html).not.toContain('frais de port en sus');
  });

  it('cannot be made to inject markup through a text', async () => {
    const texts = written([
      ['bar.shipping', '<img src=x onerror=alert(1)>'],
      ['pledge.payment', '<script>x</script>'],
      ['product.priceNote', '<img src=x onerror=alert(1)>'],
      ['product.delivery', '<script>x</script> [x](javascript:alert(1))'],
    ]);
    const pages = [
      await renderWith(AltHeader, { model: shell(texts) }),
      await renderWith(AltFooter, { model: shell(texts) }),
      await renderWith(AltProductDetail, { model: detail(texts), purchase }),
    ];
    for (const html of pages) expect(html).not.toMatch(/<img src=x|<script>x|href="javascript/);
  });

  it.skipIf(!isShippedTheme(resolveTheme().id))('leaves a shell and a product page that read none unchanged', async () => {
    const texts = written([['bar.shipping', 'Point relais dès 3,90\u00a0€']]);
    expect(await renderWith(Header, { model: shell(texts) })).toBe(await renderWith(Header, { model: shell({}) }));
    expect(await renderWith(Footer, { model: shell(texts) })).toBe(await renderWith(Footer, { model: shell({}) }));
    expect(await renderWith(ProductDetail, { model: detail(texts), purchase })).toBe(
      await renderWith(ProductDetail, { model: detail({}), purchase }),
    );
  });
});
