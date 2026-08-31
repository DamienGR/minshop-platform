import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ROUTES, settle } from './pages.mjs';

/**
 * axe, on every storefront route, at both sizes.
 *
 * Scoped to WCAG 2.1 A and AA. Not "every rule axe ships": the best-practice
 * set contains judgement calls a design is allowed to disagree with, and a gate
 * that fires on those teaches people to add exclusions until it fires on
 * nothing. These four tags are the ones a French shop is actually held to.
 *
 * The failure message lists the rule, its impact and the offending selector,
 * because "axe found 3 violations" is not something anybody can act on.
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const describe = (violations) =>
  violations
    .map(
      (v) =>
        `  ${v.id} (${v.impact}) — ${v.help}\n` +
        v.nodes.map((n) => `      ${n.target.join(' ')}`).join('\n'),
    )
    .join('\n');

for (const { name, path } of ROUTES) {
  test(`${name} n'a aucune violation WCAG A/AA`, async ({ page }) => {
    const response = await page.goto(path);
    // A 404 route is SUPPOSED to answer 404; everything else must be 200, and a
    // 500 that renders an error page would otherwise pass every axe check on it.
    expect(response?.status()).toBe(path === '/no-such-page' ? 404 : 200);
    await settle(page);

    const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    expect(violations.length, `${name} :\n${describe(violations)}`).toBe(0);
  });
}
