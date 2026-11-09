import { describe, it, expect } from 'vitest';
import { formatMoney } from '../../money';
import type { ShippingConfig } from './calculator';
import { estimateLines, estimateShipping, type ShippingEstimateInput } from './estimate';

/** The ticket's shop (#220, #221): home paid, relay offered from 60 €. */
const artisan: ShippingConfig = {
  enabled: true,
  zones: [
    {
      countries: ['FR'],
      rates: [
        { label: 'Colissimo', pricing: { type: 'flat', amountCents: 690 } },
        {
          label: 'Mondial Relay',
          pricing: { type: 'relay', offer: 'MONR-CpourToi', price: { type: 'flat', amountCents: 390 } },
          freeOverCents: 6000,
        },
      ],
      freeOverCents: null,
    },
  ],
};

const RELAY = ['MONR-CpourToi'];
const at = (subtotalCents: number, over: Partial<ShippingEstimateInput> = {}): ShippingEstimateInput => ({
  subtotalCents,
  country: 'FR',
  itemWeightGrams: 800,
  relayOffers: RELAY,
  ...over,
});
const euros = (cents: number) => formatMoney(cents, 'eur');
const said = (config: ShippingConfig, input: ShippingEstimateInput) => {
  const estimate = estimateShipping(config, input);
  return estimate ? estimateLines(estimate, euros).map((line) => line.text) : null;
};

describe('estimateShipping', () => {
  it('announces the cheapest delivery and what is missing for the relay offered (ticket #220)', () => {
    expect(estimateShipping(artisan, at(4750))).toEqual({
      delivery: { fromCents: 390, next: { relayOnly: true, remainingCents: 1250 } },
      pickupCents: null,
    });
    expect(said(artisan, at(4750))).toEqual([
      `Livraison dès ${euros(390)}`,
      `Plus que ${euros(1250)} pour la livraison offerte en point relais`,
    ]);
  });

  it('says the relay is offered once the threshold is reached', () => {
    expect(said(artisan, at(6000))).toEqual(['Livraison offerte en point relais']);
    expect(said(artisan, at(12000))).toEqual(['Livraison offerte en point relais']);
  });

  it('counts the relay only where the shop can serve it, as the checkout does', () => {
    // No relay offer: the next step quotes Colissimo alone, and nothing is offered.
    expect(estimateShipping(artisan, at(4750, { relayOffers: undefined }))).toEqual({
      delivery: { fromCents: 690, next: null },
      pickupCents: null,
    });
    expect(said(artisan, at(9000, { relayOffers: [] }))).toEqual([`Livraison dès ${euros(690)}`]);
  });

  it('announces the zone threshold as a home delivery', () => {
    const zoneOffer: ShippingConfig = {
      enabled: true,
      zones: [{ countries: ['FR'], rates: [{ label: 'Colissimo', amountCents: 590 }], freeOverCents: 6000 }],
    };
    expect(said(zoneOffer, at(4750))).toEqual([
      `Livraison dès ${euros(590)}`,
      `Plus que ${euros(1250)} pour la livraison offerte`,
    ]);
    expect(said(zoneOffer, at(6000))).toEqual(['Livraison offerte']);
  });

  it('takes the nearest threshold, and says relay only when every free delivery there is one', () => {
    const both: ShippingConfig = {
      enabled: true,
      zones: [{ ...artisan.zones[0]!, freeOverCents: 8000 }],
    };
    expect(estimateShipping(both, at(4750))?.delivery).toEqual({
      fromCents: 390,
      next: { relayOnly: true, remainingCents: 1250 },
    });
    // Past the relay's threshold, the relay is free: the zone's is not needed.
    expect(said(both, at(7000))).toEqual(['Livraison offerte en point relais']);
    const sameThreshold: ShippingConfig = {
      enabled: true,
      zones: [{ ...artisan.zones[0]!, freeOverCents: 6000 }],
    };
    expect(said(sameThreshold, at(4750))).toEqual([
      `Livraison dès ${euros(390)}`,
      `Plus que ${euros(1250)} pour la livraison offerte`,
    ]);
  });

  it('announces no threshold the checkout would not honour', () => {
    // A relay-only zone's threshold conjures nothing (the calculator's rule).
    const relayOnly: ShippingConfig = {
      enabled: true,
      zones: [{ countries: ['FR'], rates: [artisan.zones[0]!.rates[1]!].map((r) => ({ ...r, freeOverCents: null })), freeOverCents: 6000 }],
    };
    expect(said(relayOnly, at(4750))).toEqual([`Livraison dès ${euros(390)}`]);
    // Nor a threshold whose rate is too heavy for its carrier.
    const capped: ShippingConfig = {
      enabled: true,
      zones: [
        {
          countries: ['FR'],
          rates: [
            { label: 'Colissimo', pricing: { type: 'flat', amountCents: 690 } },
            {
              label: 'Lettre suivie',
              pricing: { type: 'weight', bands: [{ upToGrams: 500, amountCents: 290 }] },
              freeOverCents: 3000,
            },
          ],
          freeOverCents: null,
        },
      ],
    };
    expect(said(capped, at(1000, { itemWeightGrams: 800 }))).toEqual([`Livraison dès ${euros(690)}`]);
    expect(said(capped, at(1000, { itemWeightGrams: 300 }))).toEqual([
      `Livraison dès ${euros(290)}`,
      `Plus que ${euros(2000)} pour la livraison offerte`,
    ]);
  });

  it('leaves pickup out of « dès », on a line of its own', () => {
    const withPickup: ShippingConfig = {
      enabled: true,
      zones: [
        {
          countries: ['FR'],
          rates: [
            { label: 'Retrait à l’atelier', pricing: { type: 'pickup', amountCents: 0 } },
            { label: 'Colissimo', pricing: { type: 'flat', amountCents: 690 } },
          ],
          freeOverCents: null,
        },
      ],
    };
    expect(said(withPickup, at(2000))).toEqual([`Livraison dès ${euros(690)}`, 'Retrait gratuit']);
    const pickupOnly: ShippingConfig = {
      enabled: true,
      zones: [{ countries: ['FR'], rates: [{ label: 'Retrait', pricing: { type: 'pickup', amountCents: 200 } }], freeOverCents: 5000 }],
    };
    expect(estimateShipping(pickupOnly, at(9000))).toEqual({ delivery: null, pickupCents: 200 });
    expect(said(pickupOnly, at(9000))).toEqual([`Retrait sur place : ${euros(200)}`]);
  });

  it('says nothing rather than a wrong figure', () => {
    // A weight-priced rate hidden by an unknown weight.
    const byWeight: ShippingConfig = {
      enabled: true,
      zones: [
        {
          countries: ['FR'],
          rates: [
            { label: 'Lettre suivie', pricing: { type: 'flat', amountCents: 490 } },
            { label: 'Colissimo', pricing: { type: 'weight', bands: [{ upToGrams: null, amountCents: 290 }] } },
          ],
          freeOverCents: null,
        },
      ],
    };
    expect(estimateShipping(byWeight, at(2000, { itemWeightGrams: null }))).toBeNull();
    // A destination not served, or shipping switched off.
    expect(estimateShipping(artisan, at(2000, { country: 'BE' }))).toBeNull();
    expect(estimateShipping({ ...artisan, enabled: false }, at(2000))).toBeNull();
  });

  it('still speaks when the weight is unknown but no rate depends on it', () => {
    expect(said(artisan, at(4750, { itemWeightGrams: null }))).toEqual([
      `Livraison dès ${euros(390)}`,
      `Plus que ${euros(1250)} pour la livraison offerte en point relais`,
    ]);
  });

  it('marks as strong what the buyer can act on', () => {
    const lines = estimateLines(estimateShipping(artisan, at(4750))!, euros);
    expect(lines.map((line) => line.strong)).toEqual([false, true]);
  });
});
