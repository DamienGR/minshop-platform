/**
 * What the cart says about shipping before the address is typed (ticket #221):
 * the cheapest delivery to the destination, and how much more buys a free one.
 *
 * Read off the SAME quote the next step makes (`quoteShipping`), for the same
 * destination, weight and relay offers, so the cart cannot promise a price the
 * checkout does not charge. Pure: the caller resolves the configuration, the
 * weight and the destination, which cost no read the cart does not already do.
 *
 * Nothing rather than a wrong figure: an unknown weight that hides a rate, a
 * destination not served, a cart with nothing to ship or shipping switched off
 * all give null, and the cart stays as it was.
 */

import { t } from '../i18n/index.ts';
import { quoteShipping, normalizeRate, shippingZoneFor, type ShippingConfig, type ShippingOption } from './calculator.ts';

export interface ShippingEstimateInput {
  subtotalCents: number;
  country: string;
  /** Resolved item weight (package allowance excluded), null when unknown. */
  itemWeightGrams: number | null;
  /** Relay offers the shop can serve now: what /checkout would quote. */
  relayOffers?: readonly string[];
}

/** A delivery offered free: whether only in relay, which the cart then says. */
export interface FreeDelivery {
  relayOnly: boolean;
}

export type DeliveryEstimate =
  /** A delivery already costs nothing at this subtotal. */
  | { free: FreeDelivery }
  /** The cheapest delivery, and the next threshold that would make one free. */
  | { fromCents: number; next: (FreeDelivery & { remainingCents: number }) | null };

export interface ShippingEstimate {
  /** Home or relay. Null when the destination offers pickup only. */
  delivery: DeliveryEstimate | null;
  /** The cheapest pickup, kept apart: « dès 0 € » would say nothing true about delivery. */
  pickupCents: number | null;
}

const deliveries = (options: ShippingOption[]) => options.filter((o) => !o.pickup);
const cheapest = (options: ShippingOption[]) => Math.min(...options.map((o) => o.amountCents));
const freeOf = (options: ShippingOption[]): FreeDelivery | null => {
  const free = deliveries(options).filter((o) => o.amountCents === 0);
  return free.length === 0 ? null : { relayOnly: free.every((o) => o.relayOffer !== undefined) };
};

export function estimateShipping(cfg: ShippingConfig, input: ShippingEstimateInput): ShippingEstimate | null {
  if (!cfg.enabled) return null;
  const quoteAt = (subtotalCents: number) =>
    quoteShipping(cfg, {
      subtotalCents,
      country: input.country,
      itemWeightGrams: input.itemWeightGrams,
      ...(input.relayOffers && { relayOffers: input.relayOffers }),
    });
  const quote = quoteAt(input.subtotalCents);
  // A rate hidden by an unknown weight would make « dès » a lie; the checkout
  // names the products to fix, the cart says nothing.
  if (quote.omitted.some((o) => o.reason === 'missing_weight')) return null;
  if (quote.options.length === 0) return null;

  const pickups = quote.options.filter((o) => o.pickup);
  const pickupCents = pickups.length > 0 ? cheapest(pickups) : null;
  const sent = deliveries(quote.options);
  if (sent.length === 0) return { delivery: null, pickupCents };

  const freeNow = freeOf(quote.options);
  if (freeNow) return { delivery: { free: freeNow }, pickupCents };

  // The thresholds above the subtotal, nearest first: the zone's and each
  // rate's. Each is believed only if the quote AT it offers a free delivery —
  // the zone's never appears beside pickup alone or past a carrier maximum, and
  // a rate's not for a relay the shop cannot serve.
  const zone = shippingZoneFor(input.country, cfg.zones);
  const thresholds = [
    zone?.freeOverCents ?? null,
    ...(zone?.rates ?? []).map((rate) => normalizeRate(rate).freeOverCents ?? null),
  ].filter((cents): cents is number => cents != null && cents > input.subtotalCents);
  for (const threshold of [...new Set(thresholds)].sort((a, b) => a - b)) {
    const free = freeOf(quoteAt(threshold).options);
    if (free) {
      return {
        delivery: { fromCents: cheapest(sent), next: { ...free, remainingCents: threshold - input.subtotalCents } },
        pickupCents,
      };
    }
  }
  return { delivery: { fromCents: cheapest(sent), next: null }, pickupCents };
}

/** One line under the subtotal; `strong` for what the buyer can act on. */
export interface EstimateLine {
  text: string;
  strong: boolean;
}

/** The estimate in the storefront's words. `price` formats minor units. */
export function estimateLines(estimate: ShippingEstimate, price: (cents: number) => string): EstimateLine[] {
  const lines: EstimateLine[] = [];
  const delivery = estimate.delivery;
  if (delivery && 'free' in delivery) {
    lines.push({
      text: t(delivery.free.relayOnly ? 'cart.shipping.freeRelay' : 'cart.shipping.free'),
      strong: true,
    });
  } else if (delivery) {
    lines.push({ text: t('cart.shipping.from', { montant: price(delivery.fromCents) }), strong: false });
    if (delivery.next) {
      lines.push({
        text: t(delivery.next.relayOnly ? 'cart.shipping.remainingRelay' : 'cart.shipping.remaining', {
          montant: price(delivery.next.remainingCents),
        }),
        strong: true,
      });
    }
  }
  if (estimate.pickupCents != null) {
    lines.push({
      text:
        estimate.pickupCents === 0
          ? t('cart.shipping.pickupFree')
          : t('cart.shipping.pickup', { montant: price(estimate.pickupCents) }),
      strong: false,
    });
  }
  return lines;
}
