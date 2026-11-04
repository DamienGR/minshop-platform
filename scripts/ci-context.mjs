#!/usr/bin/env node
/**
 * What this tree runs in CI (ticket #181): the core's whole coverage, or a
 * shop's share of it.
 *
 * verify.yml and nightly.yml ship with the core into every shop. The core is a
 * public repository, whose standard runners cost nothing; a shop is a private
 * one, and pays every minute from its organisation's quota. Inherited as they
 * were, a shop's `Verify` billed about 55 minutes a run, 70 % of them for jobs
 * that question the core: `shopctl new` from this tree, the clean clone of a
 * tag the core already built, the core's four themes, the witness shops. A
 * shop's own files are its manifest, its theme and its overrides; the core it
 * runs is a tag that passed all of that before it was published.
 *
 * So a shop keeps what judges ITS tree, and the core keeps everything:
 *
 *   - `verify` everywhere, on every event: the commit merged on `main` can
 *     differ from the one its pull request tested, when `main` moved between;
 *   - the browser gate on every theme in the core; in a shop, on its own theme,
 *     on a pull request only;
 *   - every other theme's contract, and every witness shop's build, in the core
 *     only (empty matrices in a shop);
 *   - in the Nightly, the full suite every night in the core, on Mondays in a
 *     shop (and on demand). `Verify` has passed it on each commit of the shop's
 *     `main`; what the night adds is drift with no commit — a new Node 22
 *     release, a runner image, a date — which a week does not let pile up.
 *
 * A job-level `if:` cannot see the tree, hence a job that reads it first, as
 * the Nightly's `detect` does. Which themes and shops exist is a property of
 * the TREE, asked of the resolvers the build uses, never a list in a workflow:
 * a generated shop carries its own theme, and a hardcoded list would stop
 * covering it.
 *
 * The shop half must have RUN before a shop inherits it (the `paths` job of
 * verify.yml says why): test/scripts/ci-context.test.mjs asks it of a tree
 * holding a witness manifest, and the `Generated shop` job of the core's CI of
 * a real generated shop.
 *
 * Usage:
 *   node scripts/ci-context.mjs verify --event <github.event_name> [--json]
 *   node scripts/ci-context.mjs nightly --event <github.event_name> [--json]
 *
 * In GitHub Actions the answers are appended to $GITHUB_OUTPUT, one
 * `key=value` line each, matrices as JSON.
 */
import { appendFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { clientSlugs, isShopRepository } from './manifest.mjs';
import { discoverThemeIds, resolveConfiguredTheme } from './themes.mjs';

/** The day a shop's Nightly runs the full suite, as `Date#getUTCDay()` counts:
 *  Monday, so a red suite is read at the start of a working week. */
export const SHOP_SUITE_DAY = 1;

/**
 * The jobs of verify.yml beyond `verify` and `File ownership`, as matrices.
 *
 * @param {{ shop: boolean, event: string, themes: string[], configured: string, shops: string[] }} tree
 * @returns {{ shop: boolean, browser: string[], themes: string[], shops: string[] }}
 */
export function verifyContext({ shop, event, themes, configured, shops }) {
  if (!shop) {
    // `themes` leaves out the configured theme: `verify` already builds it.
    return { shop: false, browser: [...themes], themes: themes.filter((id) => id !== configured), shops: [...shops] };
  }
  return { shop: true, browser: event === 'pull_request' ? [configured] : [], themes: [], shops: [] };
}

/**
 * Whether the Nightly runs the full suite tonight.
 *
 * Asked on demand, it always does: an operator who runs the workflow by hand
 * wants the answer now.
 *
 * @param {{ shop: boolean, event: string, now: Date }} run
 */
export function nightlySuite({ shop, event, now }) {
  if (!shop || event !== 'schedule') return true;
  return now.getUTCDay() === SHOP_SUITE_DAY;
}

/** The facts verifyContext() decides from, read off the tree. */
export function readTree(root = process.cwd()) {
  const shop = isShopRepository(root);
  return {
    shop,
    themes: discoverThemeIds(root),
    configured: resolveConfiguredTheme(root).id,
    // A shop's manifest is built by `verify`, the witnesses are the core's.
    shops: shop ? [] : clientSlugs(root),
  };
}

const USAGE = 'Usage: node scripts/ci-context.mjs <verify|nightly> --event <github.event_name> [--json]';

function main(args) {
  const [workflow] = args;
  const event = args.includes('--event') ? args[args.indexOf('--event') + 1] : undefined;
  if (!['verify', 'nightly'].includes(workflow) || !event || event.startsWith('--')) {
    console.error(USAGE);
    return 2;
  }
  const root = process.cwd();
  const json = args.includes('--json');
  // A notice is a workflow command, read on stdout; under --json, stdout is
  // the answer alone.
  const notice = (text) => (json ? console.error : console.log)(`::notice::${text}`);

  let answers;
  if (workflow === 'verify') {
    answers = verifyContext({ ...readTree(root), event });
    if (answers.shop) {
      const runs = event === 'pull_request' ? `verify, File ownership et Browser (${answers.browser[0]})` : 'verify seul hors pull request';
      notice(`Boutique : ${runs} ; les autres thèmes, les boutiques témoins, Generated shop et le clone propre sont du socle, qui les passe (ticket #181).`);
    }
  } else {
    answers = { suite: nightlySuite({ shop: isShopRepository(root), event, now: new Date() }) };
    if (!answers.suite) {
      notice('Boutique : la suite complète tourne le lundi et à la demande ; Verify la passe sur chaque commit de main (ticket #181).');
    }
  }

  // JSON throughout: a boolean reads `true`/`false`, which `== 'true'` compares,
  // and a matrix is what `fromJSON()` takes.
  const lines = Object.entries(answers).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.map((line) => `${line}\n`).join(''));
  console.log(json ? JSON.stringify(answers) : lines.join('\n'));
  return 0;
}

// Run, not imported. Through the real path: a module's URL resolves symlinks,
// and a tree that links scripts/ in (nightly.test.mjs) would otherwise run
// nothing and answer nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
