import type { LocaleCatalog } from '../../../src/features/i18n';

/**
 * A locale catalog that forgot almost everything.
 *
 * DELIBERATELY BROKEN — `tsconfig.json` excludes this directory, so `astro
 * check` never sees it, and `test/i18n/catalog-typing.test.mjs` compiles it on
 * purpose to prove the compiler still says no. A guardrail nobody has watched
 * fail is indistinguishable from one that does nothing.
 */
export const incomplete: LocaleCatalog = {
  'shell.cart.link': 'Cart',
};
