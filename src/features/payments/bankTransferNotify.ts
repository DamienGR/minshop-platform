import { formatDate, getConfig } from '../../config';
import type { StoreSettings } from '../settings/db';
import { getEmailProvider } from '../email';
import { ownerAlertRecipient } from '../email/orderPolicy';
import {
  bankTransferAwaitedEmail,
  bankTransferInstructionsEmail,
  transferSummary,
} from '../email/bankTransfer';
import { bankTransferDetails } from './bankTransfer.ts';
import type { PendingPayment } from './lightning/pending';
import { storedInstant } from './bankTransferStore.ts';
import { logSafe } from '../observability/logSafe.ts';

/**
 * The e-mails of a transfer still awaited (ADR 0023), sent once, at the
 * checkout — or, for the buyer's copy, when the transfer page takes an
 * address the checkout did not ask for. Best effort: the page is the record,
 * and a send that fails is logged without what the provider said about the
 * buyer (invariant 12). The order's own e-mails go through the outbox later,
 * when the merchant records the transfer.
 */

/** The deadline as the buyer and the merchant read it, in the shop's zone. */
export function transferDue(pending: Pick<PendingPayment, 'expires_at'>, settings: StoreSettings): string {
  const due = storedInstant(pending.expires_at);
  const timeZone = settings.timeZone ?? getConfig().timeZone;
  return due === null ? '' : formatDate(new Date(due).toISOString(), { dateStyle: 'long', timeStyle: 'short' }, timeZone);
}

/** The buyer's copy of the transfer page. Skipped without an address. */
export async function sendTransferInstructions(
  pending: PendingPayment,
  settings: StoreSettings,
  payUrl: string,
): Promise<void> {
  const details = bankTransferDetails(settings);
  if (!pending.email || !details) return;
  try {
    const emailer = await getEmailProvider(settings);
    if (!emailer) return;
    const storeName = settings.storeName ?? getConfig().storeName;
    const message = bankTransferInstructionsEmail(
      transferSummary(pending, transferDue(pending, settings)),
      details,
      storeName,
      payUrl,
    );
    await emailer.send({ ...message, idempotencyKey: `bank-transfer-instructions/${pending.public_id}` });
  } catch (err) {
    console.error(`Bank transfer instructions ${pending.public_id} failed:`, logSafe(err));
  }
}

/** The merchant's notice that a transfer is coming. */
export async function sendTransferAwaited(
  pending: PendingPayment,
  settings: StoreSettings,
  origin: string,
): Promise<void> {
  const to = ownerAlertRecipient(settings.emailNotifyTo, getConfig().email.notifyTo);
  if (!to) return;
  try {
    const emailer = await getEmailProvider(settings);
    if (!emailer) return;
    const storeName = settings.storeName ?? getConfig().storeName;
    const message = bankTransferAwaitedEmail(
      transferSummary(pending, transferDue(pending, settings)),
      to,
      storeName,
      `${origin}/admin/orders#bank-transfers`,
    );
    await emailer.send({ ...message, idempotencyKey: `bank-transfer-awaited/${pending.public_id}` });
  } catch (err) {
    console.error(`Bank transfer notice ${pending.public_id} failed:`, logSafe(err));
  }
}
