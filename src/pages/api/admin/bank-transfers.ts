import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { parsePublicId } from '../../../features/ids/publicId';
import { pendingToPaidOrder } from '../../../features/payments/lightning/pending';
import { abandonAwaitedTransfer, getAwaitedTransfer } from '../../../features/payments/bankTransferStore';
import { bankTransferSessionId, transferReference } from '../../../features/payments/bankTransfer';
import { recordPaidWebhookOrder } from '../../../features/orders/recordWebhook';
import { getOrderByProviderSessionId } from '../../../features/orders/db';
import { releaseInventoryReservation } from '../../../features/orders/reservations';
import { purgeStockProductCache } from '../../../features/cache/purge';
import { getStoreSettings } from '../../../features/settings/db';
import { logSafe } from '../../../features/observability/logSafe.ts';
import { t } from '../../../features/i18n';

export const prerender = false;

// POST /api/admin/bank-transfers — the merchant's word on a transfer the shop
// waits for (ADR 0023). `transfer` is the order public id the transfer was
// opened under (ord_…), never a row id.
//
//   received  the money is on the statement: write the paid order, through the
//             same recordPaidOrder every rail settles by. Past the deadline the
//             stock was released, and the order takes it back — a shortfall
//             becomes an inventory exception, as for any late payment;
//   abandon   give up: the stock goes back on sale (if still held) and the
//             transfer can no longer be recorded.
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const form = await request.formData();
  const action = String(form.get('_action') ?? '');
  const publicId = parsePublicId(form.get('transfer'), 'order');
  const fail = (msg: string) => redirect(`/admin/orders?error=${encodeURIComponent(msg)}#bank-transfers`, 303);
  if (!publicId) return fail(t('admin.orders.transfers.error.unknown'));

  const pending = await getAwaitedTransfer(env.DB, publicId);
  if (!pending) {
    // Already settled by another click (or another tab): show that order.
    const settled = await getOrderByProviderSessionId(env.DB, bankTransferSessionId(publicId));
    if (settled) return redirect(`/admin/orders/${settled.public_id}`, 303);
    return fail(t('admin.orders.transfers.error.gone', { reference: transferReference(publicId) }));
  }

  if (action === 'received') {
    const settings = locals.settings ?? (await getStoreSettings(env.DB));
    const ctx = locals.cfContext;
    try {
      await recordPaidWebhookOrder(
        { type: 'bank_transfer.received', order: pendingToPaidOrder(pending) },
        new URL(request.url).origin,
        'bank_transfer',
        settings,
        ctx ? ctx.waitUntil.bind(ctx) : undefined,
      );
    } catch (err) {
      // The reservation is gone (released by hand, or never written): there
      // is nothing to settle against. Said, not thrown, so the page explains.
      console.error(`Bank transfer ${publicId} could not be recorded:`, logSafe(err));
      return fail(t('admin.orders.transfers.error.notRecorded', { reference: transferReference(publicId) }));
    }
    const order = await getOrderByProviderSessionId(env.DB, pending.payment_hash);
    return redirect(order?.public_id ? `/admin/orders/${order.public_id}` : '/admin/orders', 303);
  }

  if (action === 'abandon') {
    const abandoned = await abandonAwaitedTransfer(env.DB, publicId);
    if (abandoned) {
      // Still held → back on sale now. Already past its deadline → the cron
      // released it, and this is a no-op.
      await releaseInventoryReservation(env.DB, abandoned.reservationId, purgeStockProductCache);
    }
    return redirect('/admin/orders#bank-transfers', 303);
  }

  return fail(t('admin.orders.transfers.error.unknown'));
};
