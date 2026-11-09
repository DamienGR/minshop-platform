/**
 * The cart's shipping lines (ticket #221): the destination and relay offers the
 * estimate is made for, from what the request already holds — the settings the
 * middleware read, the cart's lines, the GeoIP header. No read of its own.
 *
 * Glue, kept apart from `estimate.ts` so that file stays pure and unit-tested.
 */

import { getConfig } from '../../config';
import type { StoreSettings } from '../settings/db';
import { boxtalConfigured } from '../settings/availability';
import { vaultReady } from '../secrets/store';
import { BOXTAL_RELAY_OFFERS } from './boxtal/offers';
import { allowedCountries, hasCatchAllZone, shippingZoneFor, type ShippingConfig } from './calculator';
import { isCountryCode } from './countries';
import type { StripeDestination } from './destination';
import { estimateShipping, type ShippingEstimate } from './estimate';
import type { ResolvedShipmentWeight } from './weight';

/**
 * The relay offers /checkout quotes: Boxtal's, while the option is on and its
 * keys are in the vault — the predicate `checkout.astro` and `api/checkout.ts`
 * apply before offering a relay rate. Undefined: no relay rate is counted.
 */
export function servedRelayOffers(settings: StoreSettings | null | undefined): readonly string[] | undefined {
  if (!getConfig().features.relayPoints) return undefined;
  if (!boxtalConfigured(settings?.configuredSecrets ?? [], vaultReady())) return undefined;
  return BOXTAL_RELAY_OFFERS.map((offer) => offer.code);
}

/**
 * Where /checkout opens when the cart sends no country (no card payment, so no
 * selector): the GeoIP country when the shop ships there, else the first
 * configured one. Null when neither exists: no estimate then.
 */
export function checkoutDefaultCountry(shipping: ShippingConfig, geoCountry: string | null | undefined): string | null {
  const known = allowedCountries(shipping);
  const geo = String(geoCountry ?? '').toUpperCase();
  if (isCountryCode(geo) && (hasCatchAllZone(shipping) || known.includes(geo))) return geo;
  return known[0] ?? null;
}

export interface CartShipping {
  /** One estimate per zone the cart may show, by the zone's index. */
  estimates: Map<number, ShippingEstimate>;
  /** The zone of the destination the cart shows first, or null. */
  shownZone: number | null;
  /** A country's zone index, for the selector's options; null when none serves it. */
  zoneOf: (country: string) => number | null;
}

export function cartShipping(input: {
  settings: StoreSettings | null | undefined;
  shipping: ShippingConfig;
  shipment: ResolvedShipmentWeight;
  subtotalCents: number;
  /** The card destination selector the cart renders, which also sets its default. */
  destination: StripeDestination;
  geoCountry: string | null | undefined;
}): CartShipping {
  const { shipping, shipment, destination } = input;
  const zoneOf = (country: string) => {
    const zone = shippingZoneFor(country, shipping.zones);
    return zone ? shipping.zones.indexOf(zone) : null;
  };
  const estimates = new Map<number, ShippingEstimate>();
  if (!shipping.enabled || !shipment.shippingRequired) return { estimates, shownZone: null, zoneOf };

  // The destination a payment button would price: the selector's choice when
  // the cart offers a card payment, /checkout's default otherwise.
  const shown = destination.defaultCountry ?? checkoutDefaultCountry(shipping, input.geoCountry);
  const countries = destination.showSelect ? destination.countries : shown ? [shown] : [];
  const relayOffers = servedRelayOffers(input.settings);
  // A zone prices every country it holds alike: one quote per zone, not per country.
  const byZone = new Map<number, string>();
  for (const country of countries) {
    const zone = zoneOf(country);
    if (zone != null && !byZone.has(zone)) byZone.set(zone, country);
  }
  for (const [zone, country] of byZone) {
    const estimate = estimateShipping(shipping, {
      subtotalCents: input.subtotalCents,
      country,
      itemWeightGrams: shipment.itemWeightGrams,
      ...(relayOffers && { relayOffers }),
    });
    if (estimate) estimates.set(zone, estimate);
  }
  return { estimates, shownZone: shown ? zoneOf(shown) : null, zoneOf };
}
