import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SHIPPING_LIMITS } from '../../src/features/shipping/settings.ts';

// Deliberately .mjs: reads source files, and tsconfig.compilerOptions.types is
// pinned to the Cloudflare types. Same reason as prose-source.test.mjs.
//
// The cart's shipping lines (ticket #221): with a destination selector,
// cart.astro gives each option its zone's index and each block of lines its
// own, and base.css pairs them through :has(), one rule per index. The HTML
// baselines see the markup, never which block a choice reveals.
const structural = readFileSync('src/styles/base.css', 'utf8');

describe('the cart’s destination selector', () => {
  it('reveals a line for every zone a configuration may hold, without a script', () => {
    for (let zone = 0; zone < SHIPPING_LIMITS.zones; zone++) {
      expect(structural).toContain(
        `[data-ship-estimates]:has(option[data-ship-zone='${zone}']:checked) [data-ship-estimate='${zone}']`,
      );
    }
  });

  it('shows no block until a choice reveals it', () => {
    expect(structural).toMatch(/\[data-ship-estimates\] \[data-ship-estimate\] \{\s*display: none;/);
  });
});
