import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { builtVat } from '../../scripts/store-vat.mjs';
import { DEFAULT_VAT_RATE_BPS, vatTerms } from '../../src/features/legal/vat.ts';
import { createCoreRepository, resetStoreOverrides } from '../helpers/core-repository.mjs';

/** The VAT the core ships: its default rate, no exemption. */
const CORE_VAT = vatTerms({ vatRateBps: DEFAULT_VAT_RATE_BPS, vatExemption: null });

const HEADER = "import type { DeepPartial, SiteConfig } from './config';\n\n/** The merchant's settings. */\n";

// Building the fixture core copies, commits and packs every file the tree
// tracks, and a shop's tree carries its catalogue photos too. Two seconds here,
// four in a shop, and past vitest's five-second default on both GitHub runners
// of a shop's upgrade pull request. The other suites that build one say the
// same (shopctl, fleet).
vi.setConfig({ testTimeout: 60_000 });

function tree(storeConfig) {
  const dir = mkdtempSync(join(tmpdir(), 'minshop-core-fixture-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/store.config.ts'), storeConfig);
  return dir;
}

// Ticket #173. Run from a shop, the fixture core is copied from the SHOP's tree,
// whose src/store.config.ts is the merchant's. A shop in franchise en base
// (ADR 0024) handed its exemption to every witness shop the suites make, while
// their manifest declares the template's 20 %: 24 tests of shopctl and fleet
// failed in Artisagna, on the witness shops' manifest gate, not on what they test.
describe('the fixture core, whichever tree it is built from', () => {
  it('sells at the core’s VAT', async () => {
    const core = createCoreRepository(mkdtempSync(join(tmpdir(), 'minshop-core-fixture-')));
    // Read out of the fixture: its tsconfig extends astro's, which only
    // resolves where node_modules is.
    expect(await builtVat(tree(readFileSync(join(core, 'src/store.config.ts'), 'utf8')))).toEqual(CORE_VAT);
  });

  it('takes the core’s empty overrides over a shop’s franchise', async () => {
    const dir = tree(`${HEADER}export const storeOverrides: DeepPartial<SiteConfig> = {\n  legal: { vatExemption: 'franchise' },\n  orderNumber: { offset: 1000 },\n};\n`);

    // Read once, after: an import is cached by its path, and a read before the
    // reset would be the one every later read returns.
    resetStoreOverrides(dir);

    expect(readFileSync(join(dir, 'src/store.config.ts'), 'utf8')).toBe(
      `${HEADER}export const storeOverrides: DeepPartial<SiteConfig> = {};\n`,
    );
    expect(await builtVat(dir)).toEqual(CORE_VAT);
  });

  // The Generated shop job of verify.yml commits only when the reset changed
  // the file: on the core's own shape it must change nothing.
  it('leaves the core’s own shape as it is', () => {
    const core = `${HEADER}export const storeOverrides: DeepPartial<SiteConfig> = {};\n`;
    const dir = tree(core);
    resetStoreOverrides(dir);
    expect(readFileSync(join(dir, 'src/store.config.ts'), 'utf8')).toBe(core);
  });

  it('refuses a store.config.ts that declares no overrides', () => {
    expect(() => resetStoreOverrides(tree('// travail en cours\n'))).toThrow(/declares no storeOverrides/);
  });
});
