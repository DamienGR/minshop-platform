import type { D1Database } from '@cloudflare/workers-types';
import { withPublicId } from '../ids/publicId.ts';
import { calendarDate } from '../i18n/format.ts';
import {
  judgeDiscount,
  normalizeDiscountCode,
  type DiscountCode,
  type DiscountJudgement,
  type DiscountKind,
} from './code.ts';

/**
 * Discount codes in D1 (migration 0065, ADR 0033). The rule is `./code.ts`;
 * this file reads and writes the rows and counts their uses.
 *
 * A use is an order that carries the code, or a checkout still holding it —
 * counted from those rows, never kept in a counter that a crashed checkout
 * could leave off by one. Both are indexed on `discount_code_id`, so a count
 * reads the code's own uses, never the order history
 * (test/integration/history-reads.mjs).
 */

/** The reservation statuses whose code is still spoken for. */
export const HOLDING_STATUSES = "('active', 'payment_pending')";

/** The SQL that counts one code's uses, for `?` bound twice to its id. */
export const USES_SQL = `(SELECT COUNT(*) FROM orders WHERE discount_code_id = ?)
  + (SELECT COUNT(*) FROM checkout_reservations WHERE discount_code_id = ? AND status IN ${HOLDING_STATUSES})`;

export async function findDiscountCode(db: D1Database, code: string): Promise<DiscountCode | null> {
  return db.prepare('SELECT * FROM discount_codes WHERE code = ?').bind(code).first<DiscountCode>();
}

export async function getDiscountCodeByPublicId(db: D1Database, publicId: string): Promise<DiscountCode | null> {
  return db.prepare('SELECT * FROM discount_codes WHERE public_id = ?').bind(publicId).first<DiscountCode>();
}

/** Whether any code is switched on: what decides that the buyer sees the field. */
export async function hasActiveDiscountCode(db: D1Database): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS ok FROM discount_codes WHERE active = 1 LIMIT 1').first<{ ok: number }>()) != null;
}

export async function countDiscountUses(db: D1Database, id: number): Promise<number> {
  const row = await db.prepare(`SELECT ${USES_SQL} AS n`).bind(id, id).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Whether a code a checkout was refused with can still be had — switched on,
 * under its limit. After `reserveInventory()` returns false with a code, this
 * tells a code taken meanwhile from stock that ran out.
 */
export async function discountStillHolds(db: D1Database, id: number): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM discount_codes d
        WHERE d.id = ? AND d.active = 1 AND (d.max_uses IS NULL OR ${USES_SQL} < d.max_uses)`,
    )
    .bind(id, id, id)
    .first<{ ok: number }>();
  return row != null;
}

export interface DiscountCheckInput {
  subtotalCents: number;
  currency: string;
  timeZone: string;
  /** Injected by tests; the request's own clock otherwise. */
  now?: Date;
}

/**
 * Judge what the buyer typed against this basket. Null when nothing was typed:
 * no code is not a refusal. One read for the row, one for its uses, and only
 * when the row exists and could still count.
 */
export async function checkDiscountCode(
  db: D1Database,
  raw: unknown,
  input: DiscountCheckInput,
): Promise<DiscountJudgement | null> {
  const typed = normalizeDiscountCode(raw);
  if (!typed) return null;
  const row = await findDiscountCode(db, typed);
  const uses = row && row.max_uses != null ? await countDiscountUses(db, row.id) : 0;
  return judgeDiscount(row, {
    subtotalCents: input.subtotalCents,
    currency: input.currency,
    today: calendarDate(input.now ?? new Date(), input.timeZone),
    uses,
  });
}

/** A code as the admin lists it: its row, the orders that used it, the checkouts holding it. */
export interface DiscountCodeRow extends DiscountCode {
  used: number;
  held: number;
}

export async function listDiscountCodes(db: D1Database): Promise<DiscountCodeRow[]> {
  const { results } = await db
    .prepare(
      `SELECT d.*,
              (SELECT COUNT(*) FROM orders o WHERE o.discount_code_id = d.id) AS used,
              (SELECT COUNT(*) FROM checkout_reservations r
                WHERE r.discount_code_id = d.id AND r.status IN ${HOLDING_STATUSES}) AS held
         FROM discount_codes d
        ORDER BY d.active DESC, d.created_at DESC, d.id DESC`,
    )
    .all<DiscountCodeRow>();
  return results ?? [];
}

export interface DiscountCodeFields {
  code: string;
  kind: DiscountKind;
  value: number;
  min_subtotal_cents: number;
  starts_on: string | null;
  ends_on: string | null;
  max_uses: number | null;
  active: number;
}

/** True when the insert or update failed because the CODE is taken (not the public id). */
export function isCodeTaken(err: unknown): boolean {
  return err instanceof Error && /UNIQUE/i.test(err.message) && /discount_codes\.code/i.test(err.message);
}

export async function createDiscountCode(db: D1Database, f: DiscountCodeFields): Promise<string> {
  return withPublicId('discountCode', async (publicId) => {
    await db
      .prepare(
        `INSERT INTO discount_codes (public_id, code, kind, value, min_subtotal_cents, starts_on, ends_on, max_uses, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(publicId, f.code, f.kind, f.value, f.min_subtotal_cents, f.starts_on, f.ends_on, f.max_uses, f.active)
      .run();
    return publicId;
  });
}

export async function updateDiscountCode(db: D1Database, id: number, f: DiscountCodeFields): Promise<void> {
  await db
    .prepare(
      `UPDATE discount_codes
          SET code = ?, kind = ?, value = ?, min_subtotal_cents = ?, starts_on = ?, ends_on = ?, max_uses = ?, active = ?
        WHERE id = ?`,
    )
    .bind(f.code, f.kind, f.value, f.min_subtotal_cents, f.starts_on, f.ends_on, f.max_uses, f.active, id)
    .run();
}

/** Switch a code on or off; its orders and its counted uses are untouched. */
export async function setDiscountCodeActive(db: D1Database, id: number, active: boolean): Promise<void> {
  await db.prepare('UPDATE discount_codes SET active = ? WHERE id = ?').bind(active ? 1 : 0, id).run();
}

/**
 * Delete a code no order and no checkout ever carried — in one statement, so
 * a checkout that takes it meanwhile cannot be left pointing at nothing. A
 * code that was used is switched off instead; false says so.
 */
export async function deleteUnusedDiscountCode(db: D1Database, id: number): Promise<boolean> {
  const result = await db
    .prepare(
      `DELETE FROM discount_codes
        WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM orders WHERE discount_code_id = ?)
          AND NOT EXISTS (SELECT 1 FROM checkout_reservations WHERE discount_code_id = ?)`,
    )
    .bind(id, id, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
