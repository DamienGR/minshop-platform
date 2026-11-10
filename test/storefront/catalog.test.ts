import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Catalog from '#theme/Catalog.astro';
import AltCatalog from './fixtures/catalog/AltCatalog.astro';
import {
  buildCatalogCategories,
  buildPaginationModel,
  buildSortModel,
  catalogRoute,
} from '../../src/features/storefront/catalog';
import type { Category } from '../../src/features/categories/db';
import { buildProductCard } from '../../src/features/storefront/productCard';
import type { CatalogPageModel } from '../../src/features/storefront/models';
import type { ListedProduct } from '../../src/features/products/cardVariants';
import { isShippedTheme, resolveTheme } from '../../scripts/themes.mjs';

/** The core's own themes draw nothing from what the catalog model newly offers
 *  — category photos and sentences, the product put forward. A shop's own theme
 *  is where those get drawn, so the assertions that say so hold the shipped
 *  themes only. */
const shipped = isShippedTheme(resolveTheme().id);

const product = (n: number, overrides: Partial<ListedProduct> = {}): ListedProduct => ({
  id: n,
  public_id: `prod_k7m2qx8vn${n}`,
  name: `Item ${n}`,
  slug: `item-${n}`,
  sku: null,
  description: null,
  price_cents: 1000 + n,
  currency: 'eur',
  image_key: null,
  file_key: null,
  file_name: null,
  file_mime: null,
  file_size_bytes: null,
  stock: 5,
  active: 1,
  variant_label: null,
  weight_grams: null,
  requires_shipping: 1,
  related_ids: null,
  tags: null,
  seo_title: null,
  seo_description: null,
  created_at: '2026-01-01T00:00:00Z',
  card_variants: null,
  ...overrides,
});

const model = (overrides: Partial<CatalogPageModel> = {}): CatalogPageModel => ({
  route: 'products',
  eyebrow: 'Shop',
  heading: 'All products',
  categories: [
    { text: 'Apparel', href: '/categories/apparel', description: null, image: null, children: [] },
  ],
  // Mirrors the loader: only the first card is the page's likely LCP image.
  products: [product(1), product(2)].map((p, i) => buildProductCard(p, { currency: 'eur', priority: i === 0 })),
  featured: null,
  texts: {},
  sort: buildSortModel('/products', 'newest', 'desc'),
  pagination: buildPaginationModel('/products', 1, 3, 'newest', 'desc'),
  ...overrides,
});

const render = async (component: unknown, value: CatalogPageModel) => {
  const container = await AstroContainer.create();
  return container.renderToString(component as never, { props: { model: value } });
};

const category = (id: number, name: string, overrides: Partial<Category> = {}): Category => ({
  id,
  public_id: `cat_k7m2qx8vn${id}`,
  name,
  slug: name.toLowerCase().replace(/[^a-z]+/g, '-'),
  parent_id: null,
  image_key: null,
  description: null,
  seo_title: null,
  seo_description: null,
  position: 0,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

// Ticket #84. One model serves both routes, and a theme that makes its home a
// showcase read which one from the prefix of its sort links.
describe('catalogRoute', () => {
  it('names the home at `/` and the list everywhere else it is mounted', () => {
    expect(catalogRoute('/')).toBe('home');
    expect(catalogRoute('/products')).toBe('products');
    expect(catalogRoute('/products/')).toBe('products');
  });
});

describe('buildCatalogCategories', () => {
  const tree = [
    category(1, 'Se laver', { image_key: 'media/laver.jpg', description: 'Pour la salle de bain.' }),
    category(2, 'Sacs à dos', { parent_id: 3 }),
    category(3, 'Partir', { image_key: 'media/partir.jpg' }),
    category(4, 'Accessoires', { parent_id: 3 }),
    category(5, 'Bijoux'),
    category(6, 'Boucles', { parent_id: 5 }),
    category(7, 'Grand-enfant', { parent_id: 6 }),
  ];

  it('lists the top level by name, each with its direct sub-categories', () => {
    const built = buildCatalogCategories(tree, {});

    expect(built.map((c) => c.text)).toEqual(['Bijoux', 'Partir', 'Se laver']);
    expect(built.find((c) => c.text === 'Partir')?.children).toEqual([
      { text: 'Accessoires', href: '/categories/accessoires' },
      { text: 'Sacs à dos', href: '/categories/sacs-dos' },
    ]);
    // Direct children only: a grandchild is its parent's business.
    expect(built.find((c) => c.text === 'Bijoux')?.children.map((c) => c.text)).toEqual(['Boucles']);
  });

  // Ticket #228: the merchant's order, at both levels, where they gave one.
  it('follows the order the merchant chose, at the top level and below', () => {
    // Top level: Se laver, Partir, Bijoux. Under Partir: Sacs à dos, Accessoires.
    const positions = new Map([[1, 1], [3, 2], [5, 3], [2, 1], [4, 2]]);
    const ranged = tree.map((c) => ({ ...c, position: positions.get(c.id) ?? 0 }));
    const built = buildCatalogCategories(ranged, {});

    expect(built.map((c) => c.text)).toEqual(['Se laver', 'Partir', 'Bijoux']);
    expect(built.find((c) => c.text === 'Partir')?.children.map((c) => c.text)).toEqual([
      'Sacs à dos',
      'Accessoires',
    ]);
  });

  it('resolves the image and carries the description, null when absent', () => {
    const built = buildCatalogCategories(tree, { sizes: '352px' });
    const laver = built.find((c) => c.text === 'Se laver');
    const bijoux = built.find((c) => c.text === 'Bijoux');

    expect(laver?.image).toMatchObject({ src: '/images/media/laver.jpg', alt: 'Se laver', priority: false });
    expect(laver?.description).toBe('Pour la salle de bain.');
    expect(bijoux?.image).toBeNull();
    expect(bijoux?.description).toBeNull();
  });

  it('publishes no storage key beyond the resolved URL, and no row id', () => {
    const [first] = buildCatalogCategories([category(9, 'Seul', { image_key: 'media/a.jpg' })], {});

    expect(Object.keys(first).sort()).toEqual(['children', 'description', 'href', 'image', 'text']);
  });
});

describe('buildSortModel', () => {
  it('names sort and direction explicitly, defaults included', () => {
    const [newest] = buildSortModel('/products', 'price', 'asc').options;

    // Pre-existing behavior: sort links are always explicit, so the default
    // option points at ?sort=newest&dir=desc rather than the bare path. Pinned
    // here because an extraction must not quietly change which URLs exist.
    expect(newest.href).toBe('/products?sort=newest&dir=desc');
  });

  it('flips direction on the field already sorting the list', () => {
    const active = buildSortModel('/products', 'price', 'asc').options.find((o) => o.current);

    expect(active?.label).toBe('Prix');
    expect(active?.direction).toBe('asc');
    expect(active?.href).toContain('dir=desc');
  });

  it('applies each inactive field its own natural direction', () => {
    const name = buildSortModel('/products', 'price', 'asc').options.find(
      (o) => o.label === 'Nom',
    );

    expect(name?.current).toBe(false);
    expect(name?.direction).toBeNull();
    expect(name?.href).toContain('sort=name');
    expect(name?.href).toContain('dir=asc');
  });

  it('drops the page when the ordering changes', () => {
    // Re-sorting while holding page 7 would land a shopper mid-list.
    for (const option of buildSortModel('/products', 'price', 'asc').options) {
      expect(option.href).not.toContain('page=');
    }
  });

  it('stays on the path it was given', () => {
    for (const option of buildSortModel('/categories/apparel', 'newest', 'desc').options) {
      expect(option.href.startsWith('/categories/apparel')).toBe(true);
    }
  });
});

describe('buildPaginationModel', () => {
  it('produces nothing to render for a single page', () => {
    const single = buildPaginationModel('/products', 1, 1, 'newest', 'desc');

    expect(single.items).toEqual([]);
    expect(single.prevHref).toBeNull();
    expect(single.nextHref).toBeNull();
  });

  it('omits page=1 so the first page has one URL, not two', () => {
    const { prevHref } = buildPaginationModel('/products', 2, 5, 'newest', 'desc');

    expect(prevHref).toBe('/products');
  });

  it('carries a non-default sort through every page link', () => {
    const { nextHref } = buildPaginationModel('/products', 1, 5, 'price', 'asc');

    expect(nextHref).toContain('sort=price');
    expect(nextHref).toContain('dir=asc');
    expect(nextHref).toContain('page=2');
  });

  it('elides the middle of a long series', () => {
    const { items } = buildPaginationModel('/products', 10, 20, 'newest', 'desc');
    const pages = items.map((item) => item.page);

    expect(pages).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(items.find((item) => item.page === null)?.href).toBeNull();
    expect(items.find((item) => item.current)?.page).toBe(10);
  });
});

describe('the store-owned catalog', () => {
  it('renders headings, categories, and cards', async () => {
    const html = await render(Catalog, model());

    expect(html).toContain('All products');
    expect(html).toContain('href="/categories/apparel"');
    expect(html).toContain('href="/products/item-1"');
    expect(html).toContain('10,01\u00a0\u20ac');
  });

  it.skipIf(!shipped)('renders the same with or without category images and descriptions', async () => {
    // Ticket #158: the shipped themes read neither, so a merchant filling them
    // in for a theme that does changes nothing on these.
    const bare = await render(Catalog, model());
    const dressed = await render(
      Catalog,
      model({
        categories: [
          {
            text: 'Apparel',
            href: '/categories/apparel',
            description: 'Une phrase.',
            image: { src: '/images/media/apparel.jpg', alt: 'Apparel', priority: false },
            children: [{ text: 'Hats', href: '/categories/hats' }],
          },
        ],
      }),
    );

    expect(dressed).toBe(bare);
  });

  it.skipIf(!shipped)('renders the same whether or not a product is put forward', async () => {
    // Ticket #164: the model offers it; the shipped themes do not show it.
    const bare = await render(Catalog, model());
    const featured = await render(
      Catalog,
      model({ featured: buildProductCard(product(9), { currency: 'eur', priority: true }) }),
    );

    expect(featured).toBe(bare);
  });

  it('announces an empty catalog instead of rendering a blank grid', async () => {
    // The wording belongs to the design; that the state is ANNOUNCED does not.
    // Asserting only "no product links" would pass if the empty state were
    // deleted outright, leaving a shopper with a silent blank page.
    const html = await render(Catalog, model({ products: [] }));
    const status = html.match(/<[^>]*role="status"[^>]*>([\s\S]*?)<\//);

    expect(html).not.toContain('href="/products/');
    expect(status).not.toBeNull();
    expect(status?.[1].trim().length).toBeGreaterThan(0);
  });

  it('keeps pagination a labelled landmark with rel hints', async () => {
    const html = await render(Catalog, model());

    expect(html).toContain('aria-label="Pagination"');
    expect(html).toContain('rel="next"');
    expect(html).toContain('aria-current="page"');
  });

  it('hides pagination entirely on a single page', async () => {
    const html = await render(
      Catalog,
      model({ pagination: buildPaginationModel('/products', 1, 1, 'newest', 'desc') }),
    );

    expect(html).not.toContain('aria-label="Pagination"');
  });

  it('marks the sorted field for assistive technology', async () => {
    const html = await render(
      Catalog,
      model({ sort: buildSortModel('/products', 'price', 'asc') }),
    );

    // aria-current is the contract; the arrow glyph beside it is decoration.
    expect(html).toContain('aria-current="true"');
  });

  it('gives the first card image priority and no others', async () => {
    const html = await render(Catalog, model());

    expect(html.match(/loading="eager"/g)?.length).toBe(1);
    expect(html.match(/loading="lazy"/g)?.length).toBe(1);
  });

  it('publishes no numeric row identifiers', async () => {
    const html = await render(Catalog, model());

    expect(html).not.toMatch(/\bproduct[-_]?id="\d+"/);
    expect(html).not.toContain('/products/1"');
  });
});

describe('an independently authored catalog', () => {
  it('satisfies the same model without using ProductCard at all', async () => {
    // The card model has to stand on its own, not only inside the component it
    // was extracted alongside.
    const html = await render(AltCatalog, model());

    expect(html).toContain('<table');
    expect(html).toContain('data-product="prod_k7m2qx8vn1"');
    expect(html).toContain('In stock');
    expect(html).toContain('aria-label="Pagination"');
    expect(html).not.toContain('reveal group');
  });

  it('renders its own empty state from the same model', async () => {
    const html = await render(AltCatalog, model({ products: [] }));

    expect(html).toContain('Nothing to show');
  });
});
