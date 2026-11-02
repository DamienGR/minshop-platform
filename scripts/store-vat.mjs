#!/usr/bin/env node
/**
 * The VAT a shop's build sells under, and whether its manifest says the same.
 *
 * Two files describe a shop's VAT (ADR 0010, ADR 0024): the manifest's
 * `commerce.defaultVatRate` or `commerce.vatExemption`, which is the agency's
 * record, and `legal` in `src/store.config.ts`, which is what the Worker
 * computes with. Nothing at runtime compares them, so a shop in franchise en
 * base whose config still says nothing would charge 20 % by default, and a
 * liable shop whose config set an exemption by mistake would sell without VAT.
 * `npm run config:validate` refuses both through `vatDisagreement()`, as it
 * refuses a theme.config.json that names another design than the manifest.
 *
 * The effective value is store.config.ts over the core default, read in plain
 * Node: `config.ts` imports `cloudflare:workers` and cannot load here, which is
 * why the default lives in `src/features/legal/vat.ts`, a module with no
 * imports, and is imported rather than copied.
 *
 * Usage:
 *   node scripts/store-vat.mjs    → {"rateBps":2000,"exemption":null}
 *
 * The integration suite reads that line to know which terms the built Worker
 * records on a reservation, so a shop in franchise passes `npm run verify`.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_VAT_RATE_BPS, vatTerms } from '../src/features/legal/vat.ts';

export const STORE_CONFIG = 'src/store.config.ts';

/**
 * The VAT terms the build at `root` sells under: `{ rateBps, exemption }`, as
 * `vatTerms()` makes them of `getConfig().legal`. Throws when store.config.ts
 * cannot be loaded in Node — an import of a runtime module, for instance.
 *
 * @param {string} [root]
 * @returns {Promise<{ rateBps: number|null, exemption: 'franchise'|null }>}
 */
export async function builtVat(root = process.cwd()) {
  const { storeOverrides } = await import(pathToFileURL(resolve(root, STORE_CONFIG)).href);
  const legal = storeOverrides?.legal ?? {};
  return vatTerms({
    vatRateBps: legal.vatRateBps ?? DEFAULT_VAT_RATE_BPS,
    vatExemption: legal.vatExemption ?? null,
  });
}

/**
 * Why a manifest and a build disagree on VAT, or null when they agree.
 *
 * @param {{ commerce?: { defaultVatRate?: number, vatExemption?: string } }} manifest a valid manifest
 * @param {{ rateBps: number|null, exemption: string|null }} built what `builtVat()` read
 * @returns {string|null}
 */
export function vatDisagreement(manifest, built) {
  const exemption = manifest.commerce?.vatExemption;
  if (exemption !== undefined) {
    if (built.exemption === exemption) return null;
    return `client/client.yaml declares commerce.vatExemption "${exemption}" but ${STORE_CONFIG} sells at ${built.rateBps == null ? 'no configured rate' : `${built.rateBps / 100} %`}: every order would record a VAT the seller does not charge. Set legal: { vatExemption: '${exemption}' } in ${STORE_CONFIG} (ADR 0024).`;
  }
  const rate = manifest.commerce?.defaultVatRate;
  const expected = Math.round(rate * 100);
  if (built.exemption) {
    return `${STORE_CONFIG} sets legal.vatExemption "${built.exemption}" but client/client.yaml declares commerce.defaultVatRate ${rate}: the shop would sell without the VAT it owes. Remove the exemption, or declare commerce.vatExemption in the manifest in place of the rate (ADR 0024).`;
  }
  if (built.rateBps !== expected) {
    return `${STORE_CONFIG} computes with legal.vatRateBps ${built.rateBps ?? 0} but client/client.yaml declares commerce.defaultVatRate ${rate} (${expected} in basis points): orders would record a VAT split at a rate the shop's record does not give (ADR 0010).`;
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(JSON.stringify(await builtVat(process.cwd())));
}
