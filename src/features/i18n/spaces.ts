/**
 * One line of text, folded without losing French typography (tickets #175,
 * #218).
 *
 * `\s` in JavaScript matches the no-break spaces too: U+00A0 (inside « » and
 * before `:` on most keyboards), U+2007 (figure space) and U+202F (the narrow
 * one before `? ! ;`). A `/\s+/g` fold turns them into ordinary spaces, and
 * the storefront can then wrap a line before « : » or leave a « » » alone at
 * the start of one. They are typography the merchant typed, not spacing to
 * tidy, so only the breaking whitespace folds.
 *
 * A LEAF on purpose, like `locale.ts`: the admin's counters run this rule in
 * the browser, and importing anything else would ship the catalog with it.
 * The build-less CLI keeps its own copy (`seoText()` in
 * `shopctl/src/catalog/contract.mjs`), pinned to this one over a shared
 * corpus in test/scripts/catalog.test.mjs.
 */

/** Whitespace a line may break at: `\s` less the no-break spaces. Kept
 *  private: a `g` regex is stateful under `test()` and `exec()`. */
const BREAKING_SPACES = /[^\S\u00a0\u2007\u202f]+/g;

/** Every run of breaking whitespace, line breaks included, becomes one
 *  space, and the ends are trimmed. A no-break space stays where it was typed
 *  or pasted; at either end it goes with the trim, having nothing to hold. */
export function oneLine(text: string): string {
  return text.replace(BREAKING_SPACES, ' ').trim();
}
