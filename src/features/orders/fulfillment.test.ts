import { describe, expect, it } from 'vitest';
import { fulfillmentLabel, isPickupOrder } from './fulfillment';

describe('what « traitée » means for one order (ticket #238)', () => {
  it('reads a pickup off the recorded mode, never off the label', () => {
    expect(isPickupOrder({ delivery_method: 'pickup' })).toBe(true);
    for (const delivery_method of ['shipping', 'relay', 'unknown', null]) {
      expect(isPickupOrder({ delivery_method })).toBe(false);
    }
  });

  it('says a pickup is to prepare, then ready', () => {
    expect(fulfillmentLabel({ delivery_method: 'pickup', fulfillment_status: 'unfulfilled' })).toBe('À préparer');
    expect(fulfillmentLabel({ delivery_method: 'pickup', fulfillment_status: 'fulfilled' })).toBe('Prête à retirer');
  });

  it('keeps the words of a delivery, a legacy row included', () => {
    for (const delivery_method of ['shipping', 'relay', null]) {
      expect(fulfillmentLabel({ delivery_method, fulfillment_status: 'fulfilled' })).toBe('Expédiée');
      expect(fulfillmentLabel({ delivery_method, fulfillment_status: 'unfulfilled' })).not.toBe('À préparer');
    }
  });
});
