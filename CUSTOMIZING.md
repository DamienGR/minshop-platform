# Customizing your storefront

These files belong to your store. Upstream will not rewrite them, and you can
change them without reading the payment, database, or caching code.

Everything here is compiled with the app at deploy time. There is no runtime
theme engine and no code editor in Admin — you edit source, build, and deploy.

## What you own

| File | What it controls |
| --- | --- |
| `src/themes/<your-theme>/` | Your theme — templates and tokens. Created for you at setup. |
| `src/styles/overrides.css` | Optional overrides applied after your theme's tokens. |
| `src/themes/<your-theme>/Header.astro` | Logo, announcement bar, navigation, search, cart and account placement. |
| `src/themes/<your-theme>/Footer.astro` | Footer navigation and store attribution. |
| `src/themes/<your-theme>/ProductCard.astro` | Every product card — catalog, category, search, and the "You may also like" row. |
| `src/themes/<your-theme>/Catalog.astro` | The catalog page at both `/` and `/products`: headings, category links, grid, empty state. |
| `src/themes/<your-theme>/ProductDetail.astro` | The product page: gallery, details, purchase panel, and recommendations. |
| `src/themes/<your-theme>/ContentPage.astro` | The frame around a merchant's Markdown page. |
| `src/themes/<your-theme>/tokens.css` | Your theme's design tokens: the `@theme` block (colors, fonts, radii) plus the prose and container scales. |
| `src/themes/<your-theme>/texts.ts` | Optional. The texts your theme lets the merchant edit in Admin → Textes du thème — see "Texts the merchant edits". |
| `src/themes/<your-theme>/pageModels.ts`, `pages/<key>.astro` | Optional. The page models your theme offers in a page's editor, and the template that draws each — see "Page models". |
| `client/guide/*.md` | Optional. Your shop's own chapters of the admin guide, after the core's — see "Chapters of the admin guide". |

That is the whole store-owned surface.

### The header renders on every page

That includes cart, checkout, payment, account, and Admin login — not just
browse pages. A header that breaks is a checkout that breaks, so keep the core
controls listed below and change where they sit rather than what they emit.

## What you don't own

`src/features/storefront/` is upstream: the presentation models your templates
receive, and the controls they compose. `src/layouts/Layout.astro`,
`src/styles/global.css`, and everything under `src/features/` and `src/pages/`
are application code.

The split is not about trust — your templates are ordinary source with full
build-time authority. It is about surface area: a visual change should not
require you to understand cache tags, SEO invariants, or inventory rules, and it
should be impossible to break them by accident.

## The product card contract

Your card receives a `ProductCardModel`:

```ts
interface ProductCardModel {
  id: string;              // prod_ public ID — never a database row ID
  name: string;
  href: string;            // root-relative product URL
  image: StorefrontImage;  // already resolved: src, srcset, sizes, alt, priority
  formattedPrice: string;  // already formatted in the store's currency;
                           // the lowest variant's when the product has variants
  priceVaries: boolean;    // variants at different prices: print "dès …"
  inStock: boolean;        // availability only — never a quantity
  variantLabel: string | null;   // "Tissu", "Taille" — null without variants
  variants: StorefrontCardVariant[]; // { label, inStock, image | null }, merchant order
  tags: string[];          // the merchant's tags, as slugs: "non-cousu", "nouveau"
}
```

Every value arrives finished. Do not recompute prices, build image URLs from
keys, or derive availability from a stock number — those are decided upstream,
where the store's settings are known.

A card's `variants` are its active ones (fabrics, sizes), each with its own
photo when the merchant gave it one, so a card can show swatches; a variant
carries no price or quantity of its own. `tags` mean nothing to the core: the
merchant types them on the product form (or the import's `tags` column), and
your theme decides that `non-cousu` hides a line or `nouveau` draws a badge.
The product page model carries the same `tags`.

A minimal card:

```astro
---
import type { ProductCardModel } from '../features/storefront/models';
import StoreImage from '../features/storefront/controls/StoreImage.astro';

interface Props {
  card: ProductCardModel;
  index?: number;
  headingLevel?: 'h2' | 'h3';
}

const { card, headingLevel = 'h2' } = Astro.props;
const Heading = headingLevel;
---

<li>
  <a href={card.href}>
    <StoreImage image={card.image} class="w-full" />
    <Heading>{card.name}</Heading>
    <p>{card.formattedPrice}</p>
    {!card.inStock && <span>Sold out</span>}
  </a>
</li>
```

### Controls you must keep

Render images through `<StoreImage>`. It owns the responsive attributes, the
aspect hint that prevents layout shift, and the LCP behavior for the first card
on a page. Copying its markup to adjust spacing loses all three — wrap it or
pass `class` instead.

## The shell contract

`Header.astro` and `Footer.astro` receive a `StorefrontShellModel`: store name,
resolved logo, announcement, header and footer links, `enabled`/`href` pairs
for search, cart, account, and blog, and the theme's `texts` (see "Texts the
merchant edits"). Merchant links are pre-filtered to targets that are actually
publishable, so you cannot render a dead link.

Four controls carry behavior your template must not reimplement:

| Control | What it owns |
| --- | --- |
| `<StoreNav>` | Inline links plus the mobile `<details>` disclosure, which works with no JavaScript. |
| `<StoreSearch>` | GET method, the `q` field, the search landmark, the accessible label. |
| `<StoreCartControl>` | The `data-cart-open` and `data-cart-count-label` hooks the drawer script depends on. |
| `<StoreAccountControl>` | The account destination, which middleware guards. |

Each takes a `class` for placement and styling. Reimplementing one is the one
change most likely to break something silently: the cart drawer script fails
soft, so a header missing its hooks looks fine and simply stops opening.

The cart drawer itself lives in `Layout.astro`, next to the script that drives
it. Leave it there — nesting a fixed dialog inside the sticky, backdrop-filtered
header changes its positioning context.

## The catalog contract

`Catalog.astro` receives a `CatalogPageModel`: eyebrow, heading, categories,
product cards, the product put forward, the theme's texts, and finished `sort`
and `pagination` models. It runs no queries and reads no query parameters — the
loader has already parsed, bounded, and validated everything, and tagged the
response for cache invalidation.

- `categories` are the top-level ones, each a link (`text`, `href`) with its
  `description`, its resolved `image` (both null until the merchant sets them)
  and its `children`. Both lists come in the order the merchant chose in
  Admin → Catégories (alphabetical until they move one): render them as they
  arrive, never re-sorted.
- `featured` is one product card: the merchant's choice in Admin → Réglages
  while it is active, else the newest product in stock, else the newest — null
  only for an empty catalog. Its image is resolved as the page's LCP.
- `texts` holds every key your `texts.ts` declares (below), `{}` without one.
- `route` says which of the two routes is rendering: `home` at `/`, `products`
  at `/products`. A home that is a showcase and a `/products` that stays a
  list read this — never the prefix of a sort or page link.

Two controls to keep:

| Control | What it owns |
| --- | --- |
| `<CatalogSort>` | Sort links whose hrefs encode the direction flip and deliberately drop `page`. |
| `<CatalogPagination>` | The pagination landmark, `aria-current="page"`, and `rel=prev`/`rel=next`. |

Those URLs are not cosmetic: they decide which pages exist, which one is
canonical, and how many cache entries the catalog occupies. Restyle the controls
with `class`; don't rebuild their links.

The same `Catalog.astro` renders `/` and `/products`, so one edit changes both —
which is why sort and page links are built from the current path rather than a
hardcoded one, and why `route` is there for a theme that wants the two to differ.

## The product page contract

`ProductDetail.astro` receives two models. `model` is presentation — name,
formatted price, categories, gallery images, related cards, availability — and
the page's own `href`, the same string as the product's card `href`: data your
theme keys by product (a colour per product, say) is read by that key on the
card and on the page alike, and survives a rename in the admin.
`purchase` is everything the buy controls need, with the decisions already made:
`soldOut` accounts for variant-level inventory, and `showAddToCart`/`showBuyNow`
already fold in the store's cart and buy-now toggles and whether any payment
rail can actually take money.

`model.texts` holds the theme's texts (see "Texts the merchant edits"): the
line under the price, a delivery and payment fold.

The route keeps the 404, the page metadata, and the JSON-LD. Those are not
presentation, and getting them subtly wrong is invisible on the page.

| Control | What it owns |
| --- | --- |
| `<ProductGallery>` | Frame anchors the variant selector scrolls to, and LCP treatment on the first frame only. |
| `<ProductPurchaseForm>` | Form actions and methods, `product_id`/`variant_id`/`extra` field names, sold-out and required states, and `data-fullpage`. |

`data-fullpage` deserves a specific warning. The shell's cart script intercepts
submits to open the drawer; that attribute is what tells it to stand back so
Buy now performs a real navigation to `/express`. Rebuild the form without it
and nothing errors — Buy now just quietly stops working.

Both controls take a `class`. `<ProductGallery>` also takes `soldOutLabel` if
you want different wording.

## The content page contract

`ContentPage.astro` receives a title and `html` that is **already rendered from
Markdown and sanitized**. Embed it; do not parse, escape, or transform it. The
trusted-HTML boundary is upstream, and re-handling it here either double-escapes
a merchant's page or moves the XSS surface into an editable file.

Two things are contract rather than design:

- **`class="markdown-content"`** is what the prose styles are scoped to. Remove
  it and every heading, list, and link in every merchant page loses its
  typography at once, with nothing in the markup to explain why.
- **`style={model.layoutStyle}`** carries the width and title alignment the
  merchant picked in Admin. Drop it and every page reverts to the default.

The prose scale itself is yours, in your theme's `tokens.css` (outside the `@theme` block):

```css
:root {
  --prose-measure: 48rem;
  --prose-leading: 1.75;
  --prose-h1-size: 2.25rem;
  --prose-h1-tracking: -0.02em;
  --prose-h2-size: 1.5rem;
  --prose-h2-tracking: -0.01em;
  --prose-h3-size: 1.125rem;
}
```

These are plain custom properties, deliberately outside the `@theme` block:
core CSS reads them directly and they generate no utilities. Every rule that
reads one keeps the current value as its fallback, so replacing this file with a
design system's tokens and omitting one degrades to today's design rather than
to an unstyled heading.

A merchant's per-page layout preset still wins over `--prose-measure`. That is
intentional: their explicit choice of a wide or centred page outranks a theme
default.

The page the merchant chose for the contact form (Admin → Réglages) renders
the form **below** your `ContentPage`, not inside it, in the page's measure.
Your template needs nothing for it, and cannot lose it: the form is the
upstream `<ContactForm>` control, styled by your tokens (`brand`, `line`,
`surface`, `muted`) like the cart and checkout.

## Page container

The width and padding of the page are yours, via tokens the layout reads:

```css
:root {
  --page-max:   72rem;    /* content column width */
  --page-pad-x: 1.5rem;   /* horizontal padding */
  --page-pad-y: 3rem;     /* vertical padding */
}
```

Declare them in your theme's `tokens.css`. Omit any and it falls back to the value
above, so a theme that says nothing renders like the default. A dense design can
widen and tighten; an editorial one can narrow.

To run an element full-bleed to the container edge, use a negative margin equal
to your own `--page-pad-x`.

## Markers to keep

A few attributes are contract rather than styling. Reword and restyle what is
inside them; keep the marker. Each exists because the state it names would
otherwise be indistinguishable to an automated check — or to a screen reader.

| Marker | Where | Why |
| --- | --- | --- |
| `role="status"` | Catalog empty state | An empty catalog must announce itself, not render a blank grid. |
| `data-low-stock` | Product page scarcity note | Keeps scarcity distinguishable from normal availability without publishing a count. |
| `class="markdown-content"` | Content page | The hook every prose style is scoped to. |

## Two conventions the contract tests enforce

**Navigation landmarks carry a non-empty accessible name.** The name itself is
yours — "Primary", "Shop", "Main" all pass. An unlabelled `<nav>` does not.

**`<StoreNav>` renders merchant links twice**, once in the inline row and once
in the mobile disclosure, so navigation is reachable at every width with
scripts blocked. That duplication is deliberate and asserted; if a design
genuinely needs a single responsive navigation, that is a change to the control
upstream, not a test to relax in your theme.

## Rules

1. **Public IDs only.** Never render a numeric row ID.
2. **Money is server-authoritative.** `formattedPrice` is for display; a price
   posted back from a template is not trusted.
3. **No database or storage access.** Templates receive models, not queries.
4. **No request context.** `Astro.locals`, `Astro.request`, `Astro.url`, and
   `Astro.response` are unavailable by policy. If you need a value, it belongs
   in the model — open an issue rather than reaching around it.
5. **Availability is a boolean.** Exact stock counts stay private.
6. **Text comes from the catalog, not from the template.** The storefront is
   French; a hardcoded string is the one thing no test can catch for you.

## Text in a theme

Your theme may import the message catalog — it is the fourth thing the
storefront boundary allows, beside models, controls, and your own files:

```astro
---
import { t } from '../../features/i18n';
---
<button>{t('product.addToCart')}</button>
```

A key that is not in `src/features/i18n/messages.ts` does not compile, so a
typo is a build error rather than an empty button. Wording that belongs to
*your shop* rather than to the core — a tagline, an empty-state sentence — can
stay inline in your theme; anything the core already says has a key, and reusing
it means an upstream rewording reaches your theme by merge.

Two things not to do. Don't import `t` inside a client `<script>`: that ships
the whole catalog to every visitor. Pass the string in with `define:vars`
instead, the way the product page passes its "Lien copié" label. And don't
build an `Intl` formatter — `formattedPrice` and the other model fields are
already formatted in the store's locale, which is what makes `1 234,56 €` read
the same everywhere.

## Texts the merchant edits

A home's wording — the hero's title, a block's sentence — is the merchant's,
not yours, and so is what the shop promises about delivery and payment: a top
bar's "Expédié sous 3 à 5 jours", a footer's "Paiement sécurisé", the line
under a product's price. Declare it in `src/themes/<your-theme>/texts.ts`, and
Admin → Textes du thème shows one field per slot. No file, no screen, nothing
changes.

```ts
import type { ThemeTextSlot } from '../../features/storefront/models';

export const texts = [
  { key: 'hero.title', label: 'Titre de l’accueil', default: 'Né à l’atelier',
    maxLength: 80, format: 'text' },
  { key: 'hero.intro', label: 'Texte d’accroche', help: 'Sous le titre.',
    default: 'Des sacs *cousus main*.', maxLength: 600, format: 'markdown' },
] satisfies ThemeTextSlot[];
```

```astro
<h1>{model.texts['hero.title'].text}</h1>
<div set:html={model.texts['hero.intro'].html} />
```

One declaration serves every template that receives `texts`, and the
template decides where each key goes (ADR 0027, ticket #225):

| Template | Reads |
| --- | --- |
| `Header.astro`, `Footer.astro` | `model.texts` of the shell — every route, `/checkout` and `/pay` included |
| `Catalog.astro` | `model.texts` — `/` and `/products` |
| `ProductDetail.astro` | `model.texts` — every product page |

Each holds every declared key, the same values everywhere, `{}` without a
`texts.ts`. Prefixing the keys with where they go (`bar.`, `footer.`,
`product.`) keeps the admin's list readable; the screen shows the slots in the
order you declare them. Other templates (`ContentPage.astro`, `ProductCard.astro`,
page models) receive none. The texts cost no extra read: middleware fetches
them with the settings and menus, only for a theme that declares some, and
saving them purges every cached storefront page.

The label and help are shown to the merchant, so write them in French. A field
left empty, or holding the default, shows the default; a text longer than
`maxLength` is refused at saving, with a message. `text` is one line;
`markdown` arrives as `html`, rendered without HTML the way a page body is.
Write the default as it is stored (trimmed, and on one line for `text`, where
a no-break space — U+202F before `? ! ; :` — is kept as typed):
`test/storefront/themeTexts.test.ts` holds every theme on disk to the rules,
yours included. Keep a key once merchants have written to it — a renamed key is
a text that silently returns to its default.

## Page models

A page the merchant writes is « Basique » by default: its body in your
`ContentPage`. A page whose layout is yours — a brand page with a tagline and
a box of commitments, a list of points of sale — is a **page model** (ADR
0031): declare it in `src/themes/<your-theme>/pageModels.ts`, draw it in
`src/themes/<your-theme>/pages/<key>.astro`, and the page editor offers it
beside « Basique ». No declaration, nothing changes.

```ts
import type { ThemePageModel } from '../../features/storefront/models';

export const pageModels = [
  {
    key: 'points-de-vente',
    label: 'Où nous trouver',
    help: 'Une introduction, puis vos points de vente.',
    body: { label: 'Introduction' },
    zones: [
      { key: 'accroche', label: 'Accroche', format: 'text', maxLength: 160 },
      {
        key: 'points', label: 'Points de vente', itemLabel: 'Point de vente', maxItems: 20,
        fields: [
          { key: 'nom', label: 'Nom', format: 'text', maxLength: 100 },
          { key: 'horaires', label: 'Horaires', format: 'markdown', maxLength: 1000 },
        ],
      },
    ],
  },
] satisfies ThemePageModel[];
```

```astro
---
import type { ModelPageModel } from '../../../features/storefront/models';
const { model } = Astro.props as { model: ModelPageModel };
---
<article class="markdown-content">
  <h1>{model.title}</h1>
  {model.zones.accroche.text && <p>{model.zones.accroche.text}</p>}
  <Fragment set:html={model.html} />
  {model.lists.points.map((point) => (
    <section>
      <h2>{point.nom.text}</h2>
      <Fragment set:html={point.horaires.html} />
    </section>
  ))}
</article>
```

Every model has the page's body, which the model names. A zone is a text —
`text`, one line, or `markdown`, rendered exactly like the body (rows of
photos, columns, maps) — or a list of entries the merchant adds, removes and
reorders. Your template receives what `ContentPage` does, plus every declared
zone as `{ text, html }` (`html` is null for `text`, '' for an empty
`markdown`) and every list in the merchant's order, each entry with every
field: embed the HTML, never parse or escape it, and keep
`class="markdown-content"`. The layout is yours: the merchant picks the model,
not a width. Labels and helps are shown in the editor, so write them in
French.

The key of a model is its template's file name; a zone's or a field's key is
letters and digits. `test/storefront/pageModels.test.ts` holds every theme on
disk to the rules, checks that each model has its template and each template
its model, and renders each template with every zone filled, then with every
zone empty: a zone your template does not draw fails there, and so does a
template that breaks on an empty list. Keep a key
once merchants have written to it — a renamed zone is a text the page keeps
but no longer shows. The `atelier` theme carries two witnesses, « La marque »
and « Où nous trouver », to copy from.

## Chapters of the admin guide

The admin's guide (« Guide de l’administration », opened from the footer of
every admin screen, beside the screen) explains the core's screens. What only
your shop knows — what your theme does with a tag, which texts it lets the
merchant change, how its home is built — goes in `client/guide/`, one
Markdown file per chapter:

```md
## L’accueil de votre boutique

### Changer la photo de la une

1. Ouvrez **Médias**, puis cliquez sur **Importer**.
2. …
```

- The chapters follow the core's, under « Propre à votre boutique », in the
  order of their file names: number them (`01-accueil.md`, `02-etiquettes.md`).
- Each opens with its title, a `##` heading, and holds no other at that level:
  its sections are `###`.
- Write for the merchant, in French: short tasks, numbered steps, the screen's
  labels in bold, no jargon.
- `npm test` (`src/features/adminGuide/guide.test.ts`) holds them to the
  core's rules: French typography (`’`, and a narrow no-break space, U+202F,
  before `? ! ; :` and inside « »), and links that lead to a chapter of the
  guide (`#guide-orders`, `#guide-boutique-accueil`) or to an admin screen.
- They render like a page body: Markdown, never HTML.

## Styling

Tokens live in your theme's `tokens.css` (`src/themes/<your-theme>/tokens.css`),
in a Tailwind v4 `@theme` block, and become utilities automatically —
`--color-brand` gives you `bg-brand`, `text-brand`, and so on. Structure is
expressed with Tailwind utilities in your own markup.

`brand` is a FILL — buttons, primary actions, the focus ring — and `accent` is
TEXT: content-page links, hovers, the current page, the active sort. The core
never sets text in `brand`, so a vivid brand that only reaches 3:1 on your
paper stays a valid button colour; `accent` must clear 4.5:1 on `paper` and on
`surface`. A theme whose brand already does may give both the same value.

`src/styles/overrides.css` is a different, later layer: ordinary custom-property
overrides applied AFTER your theme's tokens. Its normal state is empty. Use it
for values you want to survive switching themes, or when adopting a design
system's variables wholesale; everything that defines your theme's look belongs
in the theme's own `tokens.css`.

Two token families behave differently when omitted, and the difference
matters:

- The **page and prose properties** (`--page-*`, `--prose-*`) are read by core
  CSS through `var()` with literal fallbacks. Omit one and that rule renders
  exactly as the default does.
- The **semantic `@theme` tokens** (`--color-*`, `--font-*`, `--radius-*`)
  have NO fallback: they are what generates the utilities. A theme that omits
  `--color-brand` doesn't get the default brand — `bg-brand` simply stops
  being generated. Every theme must therefore declare the complete semantic
  surface; the contract suite enforces the required names for every theme in
  the tree.

Only your active theme's directory is scanned for utilities (inactive themes are
excluded per build, and generated files under `src/styles/themes/` wire
that up — never edit or commit them). Classes you add in your theme are
generated without touching any config file.

Admin is deliberately NOT part of any of this: it compiles its own stylesheet
(`src/styles/admin.css`) with a frozen palette, so authenticated Admin pages
look the same in every store, under any theme, including dark ones.

Upstream controls keep the functional styling they need — state, accessibility,
and layout classes stay inside them. Each accepts a root `class` you can merge.
`StoreNav` takes two, `class` and `disclosureClass`, because it renders an
inline row and a mobile disclosure at different breakpoints and one prop could
only reach one of them. Restyling every internal part of a control is not
supported in this release.

## After you change something

```bash
npm run theme:check && npm run test:storefront-contract
```

The first enforces the import and request-context boundary, following each file
through its local dependencies — a control that imports a helper that imports a
binding is caught, not just a direct import.

The second renders your components from their models and asserts what has to
hold for any design: public IDs rather than row IDs, no stock counts, resolved
image URLs, LCP priority on the first card only, form and landmark semantics,
and the behavior hooks the cart drawer depends on. It ignores classes, wrappers,
copy, and layout, so a redesign should pass it unchanged.

It does not start a Worker, so it says nothing about response headers. Cache
control and cache tags are checked by the integration suite in `npm run verify`,
against a real built Worker.

Then look at the result:

```bash
npm run dev
```

Check `/`, `/products`, a category, a search result, and a product page, at
mobile and desktop widths. Try a long product name, a sold-out item, and an
empty search — those are where card layouts break.

`npm run test:storefront-equivalence` is a different tool: it asserts your HTML
matches the *default* design byte-for-byte. It exists for upstream extraction
work. If you have customized anything, it is supposed to fail, and it is not
part of `npm run verify`.

## Your theme, and upstream's

`src/themes/default/` belongs to upstream and receives improvements. Your
theme is a copy of it, created and selected when your store was scaffolded, and
upstream never writes there.

That separation is the point: edit your own theme and an upstream change to the
default can never collide with your work. Editing `default/` directly gives that
guarantee up.

The same rule covers the other shipped designs, `studio/` and `market/`, and
their ids are reserved along with `default` so upstream always has somewhere to
put them.

## Starting from Studio or Market

The shipped designs are reference implementations, and they are also legitimate
starting points. Copy one's CONTENTS into your own theme rather than selecting it
directly — a store that selects `studio` is editing an upstream directory again,
with all the collision it was scaffolded to avoid:

```bash
rm -rf src/themes/your-store
cp -R src/themes/studio src/themes/your-store
```

Leave `theme.config.json` naming `your-store`. Then run the gates:

```bash
npm run theme:check
npm run test:storefront-contract
npm run verify
```

Provenance: `default`, `studio`, and `market` are original designs written for
this repository. They embed no third-party assets — every font stack resolves
to system faces, and Studio's grain texture is an inline SVG authored here — so
copying one into your theme carries no license or attribution obligation.

Which theme is active is one value:

```json
{ "theme": "your-store" }
```

in `theme.config.json`. Change it and rebuild to try another theme;
`THEME=<id> npm run dev` does the same thing for one command.

## Resetting a file

Your templates are ordinary tracked files, so git is the undo:

```bash
git checkout HEAD -- src/themes/acme/ProductCard.astro
```

(Replace `acme` with your theme id.) Work on a branch when making large changes,
so the default is always one command away.

## Caching

Template changes take effect on deploy — the deploy purges the previous
version's HTML. Admin-managed content (products, logo, navigation) purges on its
own schedule and needs no template change.
