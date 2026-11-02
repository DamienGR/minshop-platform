import type { D1Database } from '@cloudflare/workers-types';
import type {
  CheckoutResult,
  CreateCheckoutParams,
  PaymentProvider,
  WebhookResult,
} from './provider';
import type { StoreSettings } from '../settings/db';
import {
  bankTransferDetails,
  bankTransferSessionId,
  holdSeconds,
  transferReference,
} from './bankTransfer.ts';
import { storedInstant } from './bankTransferStore.ts';
import { createPendingPayment, getPendingByPublicId } from './lightning/pending';
import { sendTransferAwaited, sendTransferInstructions } from './bankTransferNotify';

/**
 * Bank transfer (ticket #146, ADR 0023): the buyer pays into the merchant's own
 * account, and the merchant says so in the admin. createCheckout stores the
 * order's snapshot as a pending payment (backend 'bank_transfer') and sends the
 * buyer to the transfer page, /pay/<token>, which shows the account, the
 * amount, the reference and the deadline. No provider, so no webhook: the
 * order is written by "Virement reçu" (api/admin/bank-transfers.ts), through
 * the same recordPaidOrder as every rail, or never, and the cron releases the
 * stock at the deadline.
 *
 * Like Demo, it reaches here with the address and the rate already chosen on
 * /checkout, or with neither for a basket that ships nothing — the transfer
 * page then asks the e-mail.
 */
export function createBankTransferProvider(db: D1Database, settings: StoreSettings): PaymentProvider {
  return {
    async createCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
      const details = bankTransferDetails(settings);
      if (!details) throw new Error('Bank transfer is not configured.');
      const subtotal = params.lineItems.reduce((s, li) => s + li.amountCents * li.quantity, 0);
      const shippingCents = params.selectedShipping?.amountCents ?? 0;
      const publicId = params.metadata?.public_id;
      if (!publicId) throw new Error('A bank transfer needs the order identity claimed at checkout.');
      const reservationId = params.metadata?.reservation_id ?? null;
      // One deadline: the hold's own, which the cron releases at. The page and
      // the e-mails read it back from the pending row.
      const hold = reservationId
        ? await db
            .prepare('SELECT expires_at FROM checkout_reservations WHERE public_id = ?')
            .bind(reservationId)
            .first<{ expires_at: string }>()
        : null;
      const due = storedInstant(hold?.expires_at ?? null) ?? Date.now() + holdSeconds(settings.bankTransferDays) * 1000;
      await createPendingPayment(db, {
        publicId,
        paymentHash: bankTransferSessionId(publicId),
        backend: 'bank_transfer',
        bolt11: null,
        amountSat: null,
        amountTotalCents: subtotal + shippingCents,
        currency: params.lineItems[0]?.currency ?? 'eur',
        email: params.selectedShipping?.email ?? null,
        itemsJson: params.orderItemsJson ?? null,
        shippingCents,
        shippingLabel: params.selectedShipping?.label ?? null,
        shippingWeightGrams: params.selectedShipping?.weightGrams ?? null,
        deliveryMethod: params.selectedShipping?.deliveryMethod ?? null,
        shipAddressJson: params.selectedShipping ? JSON.stringify(params.selectedShipping.address) : null,
        reservationId,
        expiresAt: new Date(due).toISOString(),
      });
      const origin = new URL(params.successUrl).origin;
      const url = new URL(`/pay/${params.accessToken ?? publicId}`, origin).href;
      const pending = await getPendingByPublicId(db, publicId);
      if (pending) {
        await Promise.all([
          sendTransferInstructions(pending, settings, url),
          sendTransferAwaited(pending, settings, origin),
        ]);
      }
      return {
        url,
        bankTransfer: {
          holder: details.holder,
          iban: details.iban,
          bic: details.bic,
          reference: transferReference(publicId),
          amountCents: subtotal + shippingCents,
          expiresAt: new Date(due).toISOString(),
        },
      };
    },

    async verifyWebhook(): Promise<WebhookResult> {
      // The merchant records the transfer in the admin — nothing calls in.
      throw new Error('Bank transfer has no webhook.');
    },
    // No refund: the merchant transfers the money back themselves and records
    // it on the order (docs/operations/remboursement.md, § 4).
  };
}
