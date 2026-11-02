import type { D1Database } from '@cloudflare/workers-types';
import type { PendingPayment } from './lightning/pending';

/**
 * The bank transfers the shop is waiting for (ADR 0023).
 *
 * A transfer awaited is a `pending_payments` row (backend 'bank_transfer'),
 * never an order: invariant 2 keeps `orders` for money received. Its stock is
 * held by the checkout reservation the row names, which this Worker's cron
 * ends at the deadline. The row itself moves only by the merchant's hand:
 * to 'settled' with the order "Virement reçu" records, or to 'abandoned'.
 *
 * Kept free of `cloudflare:workers`, so the integration suites call it with a
 * D1 of their own.
 */

/** At most this many on the orders page: a shop waits for a few at a time. */
export const AWAITED_TRANSFERS_SHOWN = 100;

/**
 * The transfers still awaited, oldest first, past their deadline included —
 * the merchant decides what a late transfer becomes. Read through
 * `idx_pending_payments_backend_status` (migration 0050): the table keeps a
 * row for every Lightning and demo checkout ever opened.
 */
export async function listAwaitedTransfers(
  db: D1Database,
  limit = AWAITED_TRANSFERS_SHOWN,
): Promise<PendingPayment[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM pending_payments
        WHERE backend = 'bank_transfer' AND status = 'pending'
        ORDER BY created_at, id
        LIMIT ?`,
    )
    .bind(limit)
    .all<PendingPayment>();
  return results ?? [];
}

/** One awaited transfer by its order public id, or null once it moved on. */
export async function getAwaitedTransfer(
  db: D1Database,
  orderPublicId: string,
): Promise<PendingPayment | null> {
  return db
    .prepare(
      `SELECT * FROM pending_payments
        WHERE public_id = ? AND backend = 'bank_transfer' AND status = 'pending'`,
    )
    .bind(orderPublicId)
    .first<PendingPayment>();
}

/**
 * Give up on a transfer: the row becomes 'abandoned' and can no longer be
 * recorded as received. Guarded on 'pending', so it loses cleanly to a
 * "Virement reçu" that settled first. Returns the reservation to release, or
 * null when nothing changed.
 */
export async function abandonAwaitedTransfer(
  db: D1Database,
  orderPublicId: string,
): Promise<{ reservationId: string } | null> {
  const row = await db
    .prepare(
      `UPDATE pending_payments SET status = 'abandoned'
        WHERE public_id = ? AND backend = 'bank_transfer' AND status = 'pending'
        RETURNING public_id, reservation_id`,
    )
    .bind(orderPublicId)
    .first<{ public_id: string; reservation_id: string | null }>();
  return row ? { reservationId: row.reservation_id ?? row.public_id } : null;
}

/**
 * Record the e-mail a buyer gave on the transfer page, when the checkout took
 * none (a basket with nothing to ship skips the address step). Never replaces
 * one already there: the page is reachable by whoever holds its link.
 */
export async function setAwaitedTransferEmail(
  db: D1Database,
  orderPublicId: string,
  email: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE pending_payments SET email = ?
        WHERE public_id = ? AND backend = 'bank_transfer' AND status = 'pending' AND email IS NULL`,
    )
    .bind(email, orderPublicId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** A stored timestamp as an instant: SQLite's `datetime()` carries no zone. */
export function storedInstant(value: string | null): number | null {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Whether a transfer's deadline has passed: its stock is no longer held. */
export function transferOverdue(pending: Pick<PendingPayment, 'expires_at'>, now = Date.now()): boolean {
  const due = storedInstant(pending.expires_at);
  return due !== null && due <= now;
}
