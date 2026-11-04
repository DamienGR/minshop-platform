/**
 * Presentation models for store-owned templates.
 *
 * These are the ONLY shapes an editable storefront file receives. Database rows
 * are deliberately absent: a row would publish internal numeric IDs, storage
 * keys, mutable columns, and query-specific accidents as a de facto contract,
 * and every one of those becomes something a template edit can break.
 *
 * Two rules govern what belongs here:
 *
 * 1. Values arrive resolved. A template never derives an R2 URL, calculates
 *    money, infers stock from a quantity, or constructs an API path.
 * 2. The contract stays as small as the default template needs. Every field is
 *    a compatibility promise; an unused one is a promise bought for nothing.
 */

/**
 * A fully resolved image. Never an image key and never an unresolved delivery
 * choice: `src`/`srcset` already reflect the store's original-vs-Cloudflare
 * setting and the usage's width ladder, decided in the builder where that
 * setting is known.
 */
export interface StorefrontImage {
  /** Root-relative or absolute URL; never an R2 key. */
  src: string;
  /** Responsive candidates, when the delivery mode produces a ladder. */
  srcset?: string;
  /** Browser sizing hint paired with `srcset`. */
  sizes?: string;
  alt: string;
  /**
   * Marks the page's likely LCP image. Upstream decides this, because it
   * selects both the wider fallback candidate and the eager/high-priority
   * attributes — a template that could set one without the other would be able
   * to silently regress LCP.
   */
  priority: boolean;
}

/**
 * One variant under a card — a swatch in a list's colour chart (ticket #161).
 * A label and an availability, never a price or a quantity: the card is a
 * link to the product page, where the variant is chosen and priced.
 */
export interface StorefrontCardVariant {
  label: string;
  /** False when this variant is sold out; the same rule as the product page. */
  inStock: boolean;
  /** The variant's own photo, resolved like the card's, or null when it names
   *  none — a swatch then has nothing to show but its label. */
  image: StorefrontImage | null;
}

/** A product as a catalog/search/recommendation card. */
export interface ProductCardModel {
  /** `prod_` public ID. Never a row ID. */
  id: string;
  name: string;
  /** Root-relative product URL. */
  href: string;
  image: StorefrontImage;
  /** Server-formatted price in the store's currency: the lowest variant's when
   *  the product has variants, as on its page. Display only — money is never
   *  posted back from a template as authority. */
  formattedPrice: string;
  /** True when the variants disagree on price, so the card reads "from …". */
  priceVaries: boolean;
  /** Availability as a boolean, deliberately not a quantity: exact stock counts
   *  stay private, and bucket-level changes avoid cache invalidation. With
   *  variants, true while any one is in stock — the variant is the unit sold. */
  inStock: boolean;
  /** The merchant's name for the variant group ("Tissu"), or null. */
  variantLabel: string | null;
  /** Active variants in the merchant's order; empty for a product without. */
  variants: StorefrontCardVariant[];
  /** The merchant's tags (ticket #159): slugs such as `nouveau`, which mean
   *  what the theme makes them mean — a badge, a hidden line. Empty for none. */
  tags: string[];
}

/** A resolved navigation link. Targets are validated upstream, so a template
 *  never renders a dead link or has to ask whether one is publishable. */
export interface StorefrontLink {
  text: string;
  href: string;
}

/**
 * A category as a theme may present it — its photo, its sentence, and the line
 * of its sub-categories under it (ticket #158). Extends the link, so a theme
 * that prints only `text` and `href` reads it as before.
 */
export interface StorefrontCategory extends StorefrontLink {
  /** Plain text, already trimmed; null when the merchant wrote none. */
  description: string | null;
  /** Resolved like a card image; null when the category has none — a theme
   *  decides what an imageless category looks like. */
  image: StorefrontImage | null;
  /** Its direct sub-categories, sorted by name. */
  children: StorefrontLink[];
}

/**
 * Everything the header and footer need, for every route that renders them.
 *
 * The shell is not browse-only: it wraps cart, checkout, payment, account, and
 * Admin login too. So this model is deliberately inert — links, labels, and
 * flags. Nothing here can start a request or change state.
 */
export interface StorefrontShellModel {
  storeName: string;
  /** Resolved header logo, or null to fall back to the store name as text. */
  logo: StorefrontImage | null;
  /** Escaped message plus an already-validated link, or null when unset. */
  announcement: { text: string; href: string | null } | null;
  headerLinks: StorefrontLink[];
  footerLinks: StorefrontLink[];
  /** Form action plus the current query, so the field repopulates on /search. */
  search: { action: string; query: string };
  cart: { enabled: boolean; href: string };
  account: { enabled: boolean; href: string };
}

/** One sort control. `current` marks the field the list is ordered by; clicking
 *  it again flips direction, which is why `href` already carries the flip. */
export interface StorefrontSortOption {
  label: string;
  href: string;
  current: boolean;
  /** Direction currently applied, on the current option only. */
  direction: 'asc' | 'desc' | null;
}

export interface StorefrontSortModel {
  options: StorefrontSortOption[];
}

/** A page link, or an elision gap when `page` is null. */
export interface StorefrontPaginationItem {
  page: number | null;
  href: string | null;
  current: boolean;
}

export interface StorefrontPaginationModel {
  page: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
  /** Windowed page list, gaps included — e.g. 1 … 4 5 6 … 20. */
  items: StorefrontPaginationItem[];
}

/**
 * The catalog, rendered at both `/` and `/products`.
 *
 * Every URL here is already built and bounded. A template neither parses query
 * parameters nor constructs them: page and sort links carry the exact query
 * semantics the catalog depends on, including dropping defaults so the canonical
 * URL stays clean and cacheable.
 */
export interface CatalogPageModel {
  /**
   * Which of the two routes is rendering (ticket #84): `home` at `/`, where the
   * catalog is the home page, `products` at `/products`, the list's own URL.
   * A theme that makes its home a showcase and keeps `/products` a list reads
   * THIS, never the shape of a sort or page link.
   */
  route: 'home' | 'products';
  eyebrow: string;
  heading: string;
  /** The top-level categories, sorted by name, each with its sub-categories. */
  categories: StorefrontCategory[];
  products: ProductCardModel[];
  /**
   * The product put forward (ticket #164): the merchant's choice in Admin →
   * Réglages while it is active, else the newest product in stock, else the
   * newest — null only for an empty catalogue. The same on every page of the
   * list, and possibly one of `products` too: whether to show it twice is the
   * theme's call. Its image is resolved as the page's likely LCP.
   */
  featured: ProductCardModel | null;
  /**
   * The texts the theme declares in its `texts.ts` (ticket #165), by key: what
   * the merchant wrote in Admin → Textes du thème, else the slot's default.
   * Every declared key is present; a theme that declares none gets `{}`.
   */
  texts: Record<string, ThemeText>;
  sort: StorefrontSortModel;
  pagination: StorefrontPaginationModel;
}

/**
 * A text the theme lets the merchant edit (ticket #165, ADR 0027), declared in
 * the theme's optional `src/themes/<id>/texts.ts`:
 *
 *     import type { ThemeTextSlot } from '../../features/storefront/models';
 *     export const texts = [
 *       { key: 'hero.title', label: 'Titre de l’accueil', default: 'Né à l’atelier',
 *         maxLength: 80, format: 'text' },
 *     ] satisfies ThemeTextSlot[];
 *
 * The label and help are shown in the admin, so they are written for the
 * merchant, in French.
 */
export interface ThemeTextSlot {
  /** What the template reads, `model.texts['hero.title']`: a lowercase letter,
   *  then letters, digits, `.` or `-` — 64 characters at most. */
  key: string;
  label: string;
  /** One sentence under the field, for where the text appears. */
  help?: string;
  /** Shown until the merchant writes something; may be ''. */
  default: string;
  /** In characters, 5 000 at most. A longer text is refused at saving. */
  maxLength: number;
  /** `text`: one line, whitespace collapsed. `markdown`: rendered without HTML
   *  (invariant 11), the way a page body is. */
  format: 'text' | 'markdown';
}

/** One theme text, resolved. `html` is the rendered Markdown of a `markdown`
 *  slot, safe for `set:html`; null for a `text` slot, which prints `text`. */
export interface ThemeText {
  text: string;
  html: string | null;
}

/**
 * One gallery image. `anchor` is the in-page target the thumbnails link to and
 * the variant selector points at — a `pimg_` public ID (the object key only as
 * a pre-backfill fallback), never a row ID.
 */
export interface StorefrontGalleryImage {
  anchor: string;
  hero: StorefrontImage;
  thumbnail: StorefrontImage;
}

/** A selectable variant. `priceCents` is present because the live price script
 *  reads it; it is display-only, and the server recomputes every total. */
export interface StorefrontVariant {
  id: string;
  label: string;
  formattedPrice: string;
  priceCents: number;
  soldOut: boolean;
  /** The first in-stock variant, pre-selected so the form is submittable. */
  defaultSelected: boolean;
  /** Gallery anchor to scroll to when this variant is chosen; '' when none. */
  imageAnchor: string;
}

/** A checkbox add-on layered on the line price. */
export interface StorefrontExtra {
  id: string;
  label: string;
  formattedPriceDelta: string;
  priceDeltaCents: number;
}

/**
 * A free-text field the buyer fills in — the name to embroider (ticket #125).
 * `required` and `maxLength` become the input's attributes, which only spare a
 * round trip: the server judges the text again, whatever the browser let by.
 */
export interface StorefrontCustomField {
  /** The form field the server reads, `custom:<cfld_…>`. */
  name: string;
  /** DOM id, for the label and the help text to point at. */
  inputId: string;
  label: string;
  help: string | null;
  maxLength: number;
  required: boolean;
}

/**
 * Everything the purchase controls need, with every decision already made.
 *
 * A template must not receive stock quantities or re-derive which buttons to
 * show: `soldOut` already accounts for variant-level inventory, and
 * `showAddToCart`/`showBuyNow` already fold in the store's runtime cart and
 * buy-now toggles and whether any payment rail can actually take money.
 */
export interface ProductPurchaseModel {
  /** `prod_` public ID, submitted by both forms. */
  productId: string;
  cartAction: string;
  expressAction: string;
  hasOptions: boolean;
  soldOut: boolean;
  showAddToCart: boolean;
  showBuyNow: boolean;
  /** Merchant's name for the variant group, e.g. "Size". */
  variantLabel: string | null;
  variants: StorefrontVariant[];
  extras: StorefrontExtra[];
  customFields: StorefrontCustomField[];
}

/** Metadata the ROUTE emits. Never handed to a template: escaping and canonical
 *  correctness are not presentation decisions. */
export interface ProductSeoModel {
  title: string;
  description: string | null;
  /** Root-relative image path for the social card. */
  imagePath: string;
  /** Serialized JSON-LD, already escaped for embedding in a script tag. */
  jsonLd: string;
}

export interface ProductDetailModel {
  id: string;
  name: string;
  /** Root-relative product URL, the same string as this product's card `href`
   *  (ticket #84): a theme that keys its own data by product reads the same
   *  key on the card and on the page, and a renamed product keeps it. */
  href: string;
  /** Raw Markdown source (also what the catalog API returns). */
  description: string | null;
  /** Rendered, sanitized HTML (renderMarkdown: raw HTML escaped, schemes
   *  filtered). Themes show THIS, inside their .markdown-content prose styles —
   *  never the raw source. */
  descriptionHtml: string | null;
  /** Lowest variant price when they differ, else the product price. */
  formattedPrice: string;
  /** Raw minor units for the live price script; display-only. */
  priceCents: number;
  currency: string;
  /** True when variants disagree on price, so the header reads "from …". */
  priceVaries: boolean;
  soldOut: boolean;
  /** Low-stock nudge, already gated: never set for a product with variants. */
  lowStock: boolean;
  digitalDelivery: boolean;
  /** The merchant's tags (ticket #159): slugs the theme reads — `non-cousu`
   *  hides a "cousu main" line on a theme that says so. Empty for none. */
  tags: string[];
  categories: StorefrontLink[];
  /** More than one image means the gallery renderer; one or none is the single
   *  hero. The distinction is the template's to make. */
  images: StorefrontGalleryImage[];
  /** Hero for the single-image case, already resolved. */
  heroImage: StorefrontImage;
  related: ProductCardModel[];
  /** Where "back to shop" goes — the catalog, wherever the merchant put it. */
  backHref: string;
  /** Validated message from ?error=, or null. */
  error: string | null;
}

/**
 * A merchant-authored content page.
 *
 * `html` is ALREADY rendered from Markdown and sanitized. A template embeds it
 * and does not parse, re-sanitize, or transform it: the trusted-HTML boundary
 * is upstream, and moving any part of it into an editable file would move the
 * XSS surface with it.
 */
export interface ContentPageModel {
  title: string;
  /** Rendered, sanitized page body. */
  html: string;
  /** Layout preset key, exposed as a data attribute so presets can target it. */
  layout: string;
  /** Inline custom properties for the preset's measure and title alignment. */
  layoutStyle: string;
}

/** The fields of the contact form, as the visitor typed them. */
export interface ContactFormValues {
  name: string;
  email: string;
  phone: string;
  reason: string;
  message: string;
}

/**
 * The contact form under the merchant's chosen page (ADR 0025). Rendered by
 * the page route under the theme's ContentPage, so a theme frames the page and
 * its tokens style the form, without any template having to know it exists.
 *
 * `errors` and `formError` are sentences already in French: the control
 * prints them, it does not choose them.
 */
export interface ContactFormModel {
  /** Where the form posts: the page's own path. */
  action: string;
  /** The reasons on offer, in the merchant's order. */
  reasons: string[];
  /** What the visitor typed, handed back after a refusal; empty at first. */
  values: ContactFormValues;
  /** One sentence per refused field. */
  errors: Partial<Record<keyof ContactFormValues, string>>;
  /** A refusal that belongs to no field: the challenge, the provider. */
  formError: string | null;
  /** The message went: the confirmation replaces the form. */
  sent: boolean;
}
