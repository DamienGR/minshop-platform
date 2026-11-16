import { describe, expect, it } from 'vitest';
import type { Order } from '../orders/db';
import {
  orderConfirmationEmail,
  orderNotificationEmail,
  orderPickupReadyEmail,
  orderShippedEmail,
} from './orderConfirmation';

/**
 * The e-mails of a rate that speaks to the buyer (ticket #237) and of a pickup
 * made ready (ticket #238). Both read the ORDER's copy of the rate, taken when
 * it was paid.
 */
const INSTRUCTIONS = 'Au fond de la cour, **porte bleue**.\n\n[Prendre rendez-vous](/pages/contact)';
const ORIGIN = 'https://boutique.example';

const order = (over: Partial<Order> = {}): Order =>
  ({
    id: 42,
    public_id: 'ord_hpxcw4mvpf',
    email: 'buyer@example.com',
    amount_total_cents: 4406,
    shipping_cents: 0,
    discount_cents: 0,
    tax_cents: 0,
    currency: 'eur',
    status: 'paid',
    payment_method: 'stripe',
    fulfillment_status: 'fulfilled',
    tracking_carrier: null,
    tracking_number: null,
    delivery_method: 'pickup',
    shipping_label: 'Retrait à l’atelier',
    shipping_instructions: INSTRUCTIONS,
    ship_address: null,
    relay_point: null,
    buyer_comment: null,
    vat_exemption: null,
    created_at: '2026-11-16',
    ...over,
  }) as Order;

const GUEST = 'https://boutique.example/order/otk_example';

describe('orderPickupReadyEmail', () => {
  const msg = orderPickupReadyEmail(order(), 'Atelier', GUEST, ORIGIN);

  it('says the order is ready, never that it is on its way', () => {
    expect(msg.to).toBe('buyer@example.com');
    expect(msg.subject).toMatch(/^Votre commande Atelier n°\S+ est prête à retirer$/);
    expect(msg.html).toContain('Votre commande est prête');
    expect(`${msg.subject} ${msg.html} ${msg.text}`).not.toMatch(/en route|expédiée/);
  });

  it('names the place, the rate the buyer chose, with its instructions', () => {
    expect(msg.text).toContain('Où la retirer\u202f:\nRetrait à l’atelier\nAu fond de la cour, **porte bleue**.');
    expect(msg.html).toContain('Retrait à l’atelier');
    expect(msg.html).toContain('<strong>porte bleue</strong>');
    expect(msg.html).toContain('href="https://boutique.example/pages/contact"');
  });

  it('links the order', () => {
    expect(msg.html).toContain(`href="${GUEST}"`);
    expect(msg.text).toContain(GUEST);
  });

  it('still names the place for a rate that said nothing more', () => {
    const bare = orderPickupReadyEmail(order({ shipping_instructions: null }), 'Atelier', null, ORIGIN);
    expect(bare.text).toContain('Où la retirer\u202f:\nRetrait à l’atelier');
    expect(bare.text).not.toContain('null');
  });
});

describe('a rate’s instructions in the other e-mails (ticket #237)', () => {
  it('appear under « Livraison » in the confirmation, before the relay point', () => {
    const msg = orderConfirmationEmail(order({ fulfillment_status: 'unfulfilled' }), [], ORIGIN, 'Atelier', 'original', GUEST);
    expect(msg.text).toContain('Livraison\u202f:\nRetrait à l’atelier\nAu fond de la cour');
    expect(msg.html).toContain('<strong>porte bleue</strong>');
    // A pickup is announced as made ready, not shipped (ticket #238).
    expect(msg.html).toContain('quand elle sera prête à retirer');
    expect(msg.html).not.toContain('à l’expédition');
  });

  it('change nothing for an order whose rate said none', () => {
    const msg = orderConfirmationEmail(
      order({ delivery_method: 'shipping', shipping_label: 'Colissimo', shipping_instructions: null }),
      [],
      ORIGIN,
      'Atelier',
    );
    expect(msg.text).not.toContain('Livraison');
    expect(msg.html).toContain('Nous vous écrirons de nouveau à l’expédition.');
  });

  it('follow a delivery into the shipped notice', () => {
    const msg = orderShippedEmail(
      order({
        delivery_method: 'shipping',
        shipping_label: 'Colissimo',
        shipping_instructions: 'Remis contre signature.',
        tracking_carrier: 'colissimo',
        tracking_number: '6A00000000000',
      }),
      'Atelier',
      GUEST,
      ORIGIN,
    );
    expect(msg.text).toContain('Livraison\u202f:\nColissimo\nRemis contre signature.');
    expect(msg.html).toContain('Remis contre signature.');
  });

  it('leave the merchant’s notification to name the rate alone', () => {
    const msg = orderNotificationEmail(order(), [], 'owner@example.com', ORIGIN, 'Atelier');
    expect(msg.text).toContain('Tarif de livraison\u202f:\nRetrait à l’atelier');
    expect(msg.html).toContain('Tarif de livraison');
    expect(msg.text).not.toContain('porte bleue');
  });
});
