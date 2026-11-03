import { parseCardVariants, type ListedProduct } from '../products/cardVariants';
import { readTags } from '../products/tags';
import { productImageSources, type ImageDelivery } from '../products/image';
import { requirePublicId } from '../catalog/serialize';
import { stockState } from '../products/stock';
import { formatMoney } from '../../money';
import type { ProductCardModel, StorefrontImage } from './models';

/**
 * Builders that turn authoritative product data into the presentation models
 * store-owned templates receive. Pure: no D1, no R2, no request context. Every
 * decision a template must not make — which delivery mode, which width ladder,
 * how money reads, whether the row is purchasable — is made here.
 */

export interface StorefrontImageOptions {
  /** config.images.baseUrl. Empty string keeps original `/images/...` delivery. */
  baseUrl?: string;
  /** The store's runtime image-delivery setting, already read from settings. */
  delivery?: ImageDelivery;
  /** Browser sizing hint for the slot this image occupies. */
  sizes?: string;
  /**
   * Marks the page's likely LCP image. Upstream owns this, not the template:
   * it selects the wider fallback candidate AND the eager/high-priority
   * attributes, and those two must never disagree. Carrying it on the resolved
   * image is what makes desync impossible.
   */
  priority?: boolean;
}

/**
 * Resolve an image key into final URLs. `usage` follows `priority` exactly as
 * ProductImage did — a priority image is the large one on the page, so it takes
 * the detail-sized fallback candidate.
 */
export function buildStorefrontImage(
  imageKey: string | null,
  alt: string,
  options: StorefrontImageOptions = {},
): StorefrontImage {
  const priority = options.priority ?? false;
  const sources = productImageSources(imageKey, {
    baseUrl: options.baseUrl,
    delivery: options.delivery,
    usage: priority ? 'detail' : 'card',
    sizes: options.sizes,
  });

  return {
    src: sources.src,
    ...(sources.srcset ? { srcset: sources.srcset } : {}),
    ...(sources.sizes ? { sizes: sources.sizes } : {}),
    alt,
    priority,
  };
}

export interface ProductCardOptions extends StorefrontImageOptions {
  /**
   * Currency to format the price in. Required, not defaulted: a default would
   * either read the store config — making this builder binding-aware, which is
   * what it must not be — or silently format in the wrong currency. Loaders
   * pass the store's configured currency.
   */
  currency: string;
}

/**
 * A product row as a card. Throws on a row without a public ID, matching the
 * catalog serializers: that is a deploy-order bug, and failing loudly beats
 * rendering a numeric row ID into a public page.
 *
 * The row must come from a listing that read its variants (`ListedProduct`,
 * features/products/cardVariants.ts): the type is what stops a new listing
 * from quietly rendering every product as if it had none.
 */
export function buildProductCard(
  product: ListedProduct,
  options: ProductCardOptions,
): ProductCardModel {
  const variants = parseCardVariants(product.card_variants);
  const hasVariants = variants.length > 0;
  const prices = variants.map((variant) => variant.price_cents);
  // The product page's rules, so a card and the page it links to agree: with
  // variants, the lowest price, "from" when they differ, and availability from
  // the variants themselves (productDetail.ts).
  const lowest = hasVariants ? Math.min(...prices) : product.price_cents;
  // Variant photos are never the LCP image: the card's own image is.
  const variantImage = { ...options, priority: false };

  return {
    id: requirePublicId(product.public_id, product.id, 'product'),
    name: product.name,
    href: `/products/${product.slug}`,
    image: buildStorefrontImage(product.image_key, product.name, options),
    // The store's currency, not the row's: a product row can carry a legacy
    // currency, and the catalog has always displayed one consistent currency.
    formattedPrice: formatMoney(lowest, options.currency),
    priceVaries: hasVariants && lowest !== Math.max(...prices),
    // Availability only — never the count. `stockState` is the authoritative
    // classification; re-deriving `stock > 0` here would fork that rule.
    inStock: hasVariants
      ? variants.some((variant) => variant.stock > 0)
      : stockState(product.stock) !== 'out',
    variantLabel: hasVariants ? product.variant_label : null,
    variants: variants.map((variant) => ({
      label: variant.label,
      inStock: variant.stock > 0,
      image: variant.image_key
        ? buildStorefrontImage(
            variant.image_key,
            variant.image_alt ?? `${product.name}, ${variant.label}`,
            variantImage,
          )
        : null,
    })),
    tags: readTags(product.tags),
  };
}
