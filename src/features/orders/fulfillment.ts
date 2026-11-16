/**
 * What « traitée » means for one order (ticket #238). A delivery is shipped;
 * a pickup is never shipped, it is made ready for the buyer to collect. Both
 * record `fulfillment_status = 'fulfilled'`, so the list, its filter and the
 * CSV export keep one logic; only the words, the action and the e-mail differ.
 *
 * Read off `delivery_method`, which checkout recorded from the rate's data —
 * never off its label, merchant prose. Only exactly 'pickup' is a pickup: a
 * home or relay order, a legacy row or a Stripe rate that lost its mode keeps
 * the shipping path it always had.
 */
import { t } from '../i18n/index.ts';

export function isPickupOrder(order: { delivery_method: string | null }): boolean {
  return order.delivery_method === 'pickup';
}

/** The word of the order's line in the admin list and on its page. */
export function fulfillmentLabel(order: { fulfillment_status: string; delivery_method: string | null }): string {
  const done = order.fulfillment_status === 'fulfilled';
  if (isPickupOrder(order)) {
    return done ? t('admin.orders.fulfillment.readyForPickup') : t('admin.orders.fulfillment.toPrepare');
  }
  return done ? t('admin.orders.fulfillment.fulfilled') : t('admin.orders.fulfillment.unfulfilled');
}
