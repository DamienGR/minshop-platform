# The browser gate

Detail page of [AGENTS.md](../../AGENTS.md), which holds the loop, the
invariants and the rules that apply everywhere. Read this before working on `test/browser/` or a theme's design.

`npm run test:browser` builds the Worker, boots it on a seeded, isolated D1, and
drives it with Playwright (`playwright.config.mjs`, specs in `test/browser/`).
It is NOT in `npm run verify`, deliberately: `verify` is what a shop runs on a
laptop and in the deploy path, and it must not need a 150 MB browser download to
answer. CI gives it its own job per theme: every theme in the core, and in a
shop its own theme only, on a pull request (ticket #181,
`scripts/ci-context.mjs`).

It exists because the container contracts are structurally blind to a whole
class of defect. They render a component from props and assert on the markup —
no stylesheet is applied, no client script runs, nothing has a width. So the
storefront could (and did) ship a live-price script that rewrote `24,00 €` to
`€24.00`, a gallery whose thumbnails were anonymous "link"s, a scroll region no
keyboard could reach, and a header that pushed the cart off a phone screen — all
with every gate green.

What it asserts, and why each one is here rather than in vitest:

- **axe** (`a11y.spec.mjs`) — WCAG 2.1 A/AA on every storefront route, both
  sizes. Scoped to those four tags on purpose: axe's best-practice set contains
  judgement calls a design may disagree with, and a gate that fires on those
  gets exclusions added until it fires on nothing.
- **keyboard** (`keyboard.spec.mjs`) — Tab reaches the cart before the grid, and
  every focus stop is visible. Focus visibility is asserted as a DIFFERENCE
  between the focused and blurred computed styles, not as "has an outline":
  a theme that lights its search field's wrapper through `focus-within:` is
  perfectly good and would fail a property allowlist. Transitions are disabled
  for that measurement — otherwise a synchronous read after `blur()` returns the
  value the transition is leaving from.
- **no JavaScript** (`cart.spec.mjs`) — AGENTS.md invariant 1 as a test. The catalogue
  renders, images are visible (the fade enhancement must not hide them), and
  adding to the cart is a real POST form.
- **reflow** (`responsive.spec.mjs`) — zero horizontal overflow on every route at
  both viewports, at 200 % zoom, and with a long store name and a long product
  name injected. WCAG 1.4.10's own 320 px bar is measured but not gated; see
  the jalon-5 État in the plan for what fails it and why that is a design call.
- **states** (`states.spec.mjs`) — empty catalogue, sold out, low stock, and six
  hostile search queries. FTS5 `MATCH` throws on raw input, so the sanitizer is
  one refactor away from a 500 on an apostrophe.
- **admin saves** (`admin-settings.spec.mjs`) — Admin → Réglages with its
  script running: a refused save shows the server's reason and keeps it on
  screen, any other failure keeps the generic line. The integration suites post
  the form without the script, and the script used to throw the reason away
  (certification, step 10). `serve.mjs` gives the fixture store an admin
  password (`admin.mjs`) and a vault for it; skipped against `BASE_URL`.
- **admin shortcut** (`admin-edit-link.spec.mjs`) — the « Modifier ce
  produit » button of a product page (ticket #178): shown to the logged-in
  admin and leading to the product's screen, absent for a shopper, whose page
  sends no request to `/api/admin`, and gone after logout or when the hint
  outlived the session. Only a browser runs the script that joins the hint to
  the probe; the security gate checks each half on its own. Skipped against
  `BASE_URL`.
- **admin guide** (`admin-guide.spec.mjs`) — the admin footer's « Guide de
  l'administration » (tickets #186 and #188): it opens the guide beside the
  screen, on that screen's chapter, keeps it open and in place on the next
  screen, and closes on Escape with focus back on the link; the guide's
  contents scroll the panel, never the screen or its URL. Without a script, the
  same link leads to `/admin/guide`. The help link writes to the address the
  deployment passes: `serve.mjs` gives the Worker one, as `shopctl deploy`
  does. The panel is a script that fetches the guide and remembers its state
  per tab, none of which a container render or a form post can see. Skipped
  against `BASE_URL`.
- **photos beside their text** (`page-photo.spec.mjs`) — a page image titled
  `"gauche"` or `"droite"` (ticket #195): past a phone's width the photo
  stands on its side and the next paragraph's first line runs beside it; on a
  phone it stays above its text; the next heading starts below it; no `title`
  reaches the page. The editor's « À gauche » and « À droite » set and undo the
  word, and the preview shows it. The unit tests prove the classes; only a
  browser applies the stylesheet that places them. `serve.mjs` seeds the page,
  which the axe and reflow routes walk too. Skipped against `BASE_URL`.
- **a row of photos** (`page-gallery.spec.mjs`) — page images written one
  under the other with no blank line (ticket #194): one square shape for all,
  the whole row on one line past a phone's width, two to a line on a phone
  with an odd last one centred; a portrait alone stops short of the screen's
  height without being squashed, its width attribute still reserving its
  room; the editor's preview shows the row, wrapping four to a line past four
  photos, and a click on one stays in the editor. A row's photo opens large
  (ticket #205, lot 1): the dialog shows the original, previous and next by
  button or arrow key with the position spoken, closes on Escape, on its
  button or a click beside the photo, and hands focus back to the photo
  clicked; a page without a row loads no lightbox, and without a script the
  link opens the photo itself. `serve.mjs` seeds the page and measures its
  photos, and draws the portrait. Skipped against `BASE_URL`.
- **text in columns** (`page-columns.spec.mjs`) — a `::: colonnes` block
  (ADR 0030): past a phone's width its columns stand side by side, equal or
  one narrow and one twice as wide; on a phone they follow one another in the
  order written, each the text's width. The editor's « Colonnes » inserts a
  block of two with the first sample selected, and the preview says what is
  wrong with a block of one. The unit tests prove the markup; only a browser
  applies the grid. `serve.mjs` seeds the page, which the axe and reflow
  routes walk too. Skipped against `BASE_URL`.
- **page models** (`page-models.spec.mjs`) — pages drawn by a theme's model
  (ADR 0031), on a theme that declares the `atelier` witnesses and skipped on
  any other: « La marque » and « Où nous trouver » in the storefront, the
  points of sale in the merchant's order; a Markdown zone's own preview, apart
  from the body's; on desktop only, since it edits the store, a list moved,
  extended and pruned by the form's own buttons and left as it was found, a
  switch to « Basique » and back that loses nothing, and « Aperçu de la page »
  showing the unsaved draft in the theme in a new tab. `serve.mjs` seeds the
  three pages; the axe and reflow routes walk the two witnesses. Skipped
  against `BASE_URL`.
- **product gallery** (`product-gallery.spec.mjs`) — the product page opens
  on the merchant's first photo even when the variant checked by default is
  linked to another (ticket #185); a variant the shopper picks brings its
  photo, an add-on ticked does not move the gallery, and Back hands the
  chosen variant's price and photo back (Chromium restores the form at
  pageshow, after the script ran). `serve.mjs` links sample-tee's default to
  its second photo and adds an in-stock Medium on a third. Skipped against
  `BASE_URL`.
- **design signature** (`design-signature.spec.mjs`) — visual regression as the
  COMPUTED style of ten probes, committed per theme under
  `test/browser/__signatures__/` for the shipped themes and under the shop's
  `client/signatures/` for its own theme (`shopctl new` seeds it from the
  reference theme's). Not `toHaveScreenshot`: a PNG baseline is only
  meaningful against the renderer that recorded it, so it needs a pinned
  container or it reports failures nobody caused — and this repository already
  spends a workflow measuring one flake. What actually regresses in a
  token-driven design is a token, and that is what this records. Colours are
  recorded as sRGB bytes, resolved through a 1×1 canvas: Tailwind compiles an
  alpha modifier (`bg-paper/85`) through `color-mix(in oklab, …)`, and the
  computed `oklab()` carries implementation-defined float precision that differs
  between Chromium builds. Re-record a deliberate change with
  `THEME=<id> UPDATE_SIGNATURE=1 npm run test:browser -- design-signature`.

Chromium comes from `npx playwright install chromium`. On a machine that already
has one and cannot download another, `test/browser/chromium.mjs` falls back to
whatever is under `PLAYWRIGHT_BROWSERS_PATH` and says so.

CI installs it without `--with-deps`: the runner image already carries every
library Chromium needs, and the fonts apt added came from a mirror that
sometimes turned a twenty-second step into ten minutes. The step launches
Chromium once and runs `npx playwright install-deps chromium` only if that
launch fails (`verify.yml` has the numbers; `test/scripts/workflows.test.mjs`
keeps `--with-deps` out).
