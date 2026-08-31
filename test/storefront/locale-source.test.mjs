import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Deliberately .mjs: it reads source files, and tsconfig.compilerOptions.types
// is pinned to the Cloudflare types. Same reason as boundary.test.mjs.
//
// Invariant 7 says only formatPrice()/formatDate() and features/i18n/format.ts
// name a locale. Nothing enforced it, and the gap was not theoretical: the
// product page's live-price script built `new Intl.NumberFormat('en-US', …)`,
// so every French product with a variant or an add-on server-rendered
// "24,00 €" and then rewrote itself to "€24.00" as soon as the script ran.
//
// No existing gate could see it. The storefront baselines are captured with
// curl, so no client script executes; the container contracts render markup
// from props and never run one either. It took opening the page in a browser.
// A source scan is the cheap regression that does not need one.

const ROOT = 'src';

/** Every tracked source file under src/, read once. */
const sources = execFileSync('git', ['ls-files', ROOT], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter((path) => /\.(astro|ts|tsx|mjs|js)$/.test(path))
  .map((path) => ({ path, text: readFileSync(path, 'utf8') }));

/**
 * The modules allowed to name a locale, and why.
 *
 * `format.ts` and `money.ts` ARE the single source of truth; `locale.ts`
 * declares the constant itself. Everything else must go through them.
 */
const LOCALE_OWNERS = new Set([
  'src/features/i18n/locale.ts',
  'src/features/i18n/format.ts',
  'src/money.ts',
]);

/**
 * Constructions whose locale argument does not reach a human.
 *
 * `Intl.DateTimeFormat('en-US').resolvedOptions().timeZone` is a zone
 * VALIDATOR — it reads back the canonical zone name and throws on a bad one,
 * and the tag chosen has no effect on the answer. Pinned by its full
 * expression rather than by file, so the exemption cannot quietly widen to a
 * date somebody displays.
 */
const NOT_DISPLAY = [
  "new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone",
];

/** `new Intl.X('tag'…)` — a construction with a LITERAL first argument. */
const LITERAL_LOCALE = /new Intl\.[A-Za-z]+\(\s*['"`][a-zA-Z-]+['"`]/g;

describe('who is allowed to name a locale', () => {
  it('finds the modules it is meant to be guarding', () => {
    // A rename or a move must fail loudly here rather than silently emptying
    // the scan and reporting green over an unguarded tree.
    const paths = new Set(sources.map((s) => s.path));
    for (const owner of LOCALE_OWNERS) expect(paths.has(owner), owner).toBe(true);
    expect(sources.length).toBeGreaterThan(100);
  });

  it('lets no other module build a formatter on a hardcoded tag', () => {
    const offenders = [];
    for (const { path, text } of sources) {
      if (LOCALE_OWNERS.has(path)) continue;
      for (const match of text.match(LITERAL_LOCALE) ?? []) {
        const line = text.split('\n').find((l) => l.includes(match)) ?? match;
        if (NOT_DISPLAY.some((allowed) => line.includes(allowed))) continue;
        offenders.push(`${path}: ${line.trim()}`);
      }
    }

    // A store that changes locale must not have to find these one screen at a
    // time. Route the value through formatPrice/formatDate, or — in a client
    // script, which cannot import them — through `define:vars`.
    expect(offenders).toEqual([]);
  });

  it('publishes the full tag on the document, beside the language subtag', () => {
    // `lang` is the language subtag ("fr"); Intl wants the full tag ("fr-FR").
    // Both from the one constant, so a client script has somewhere to read it
    // that cannot disagree with the server.
    const layout = readFileSync('src/layouts/Layout.astro', 'utf8');

    expect(layout).toContain("import { LANG, LOCALE, t } from '../features/i18n'");
    expect(layout).toContain('<html lang={LANG} data-locale={LOCALE}>');
  });

  it('has the product page read that tag rather than carry its own', () => {
    // Two sides of one contract: the layout emits the attribute, the live-price
    // script queries it. A one-sided rename passes each file in isolation — and
    // the failure is silent, because `new Intl.NumberFormat(undefined, …)` is
    // valid and simply formats in the visitor's locale instead of the store's.
    const route = readFileSync('src/pages/products/[slug].astro', 'utf8');

    expect(route).toContain('new Intl.NumberFormat(document.documentElement.dataset.locale,');
  });
});
