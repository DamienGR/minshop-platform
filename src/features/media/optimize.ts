import type { D1Database } from '@cloudflare/workers-types';
// Explicit .ts: test/integration/media-optimize.mjs loads this module through
// Node's type stripping, which does not resolve extensionless relative imports.
import { queryHref } from '../../pagination.ts';
import type { StorageProvider } from '../storage/provider.ts';
import { logSafe } from '../observability/logSafe.ts';
import type { Media } from './db.ts';
import { readImageDimensions } from './dimensions.ts';
import { OPTIMIZED_TYPE, transformForStorage } from './transform.ts';
import { mediaKeyFor, validateUpload } from './upload.ts';

/**
 * « Optimiser » in Médias (ticket #255): a photo already stored goes through the
 * transformation an upload gets, and every place that shows it moves to the
 * lighter file.
 *
 * Under a NEW key, never over the old object. `/images/*` is served immutable
 * for a year, the on-demand transforms are keyed by the source's address, and
 * the backups' media pool seals an object once per bucket and key (ADR 0019):
 * new bytes under an old key would be served stale everywhere and restored as
 * the original. The key the photo had is kept in `media.source_key`, which is
 * how the catalogue importer still recognises it (migration 0063).
 *
 * No `cloudflare:workers` import: the database, the storage and the Images
 * binding are passed in, so the integration suite runs the real statements and
 * the real binding (miniflare's offline one).
 */

/** Heavier than this, a photo is offered whatever its width: 500 Ko as Médias counts them. */
export const HEAVY_BYTES = 500 * 1024;

/**
 * Photos per request of a pass over every heavy photo. Each one costs six D1
 * statements (the move below) and the Free plan allows fifty per Worker
 * invocation, auth and the listing included: five leaves room, ten would not.
 */
export const OPTIMIZE_BATCH = 5;

/**
 * A result is kept only if it weighs at most this share of the original. Below
 * a fifth of gain the photo is called already light: a new key and six writes
 * for a few kilobytes is churn, not optimization.
 */
export const KEEP_RATIO = 0.8;

const OPTIMIZABLE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

/** The fields the rule reads, so a caller can ask about a row it only half loaded. */
export type OptimizableFields = Pick<Media, 'image_key' | 'mime_type' | 'size_bytes' | 'width' | 'optimized_at'>;

/**
 * Whether Médias offers « Optimiser » for this photo: a JPEG, PNG or WebP wider
 * than `maxWidth` or heavier than `HEAVY_BYTES`, not yet processed.
 *
 * GIFs stay as they are (an animation would not survive a WebP still), and so
 * do the rows whose type or weight is unknown — the « Ancienne image » rows a
 * migration backfilled from the bucket — and keys outside `media/`: every key
 * the move rewrites in a page body is then twenty hexadecimal characters drawn
 * at random or from a hash, which no other text contains.
 *
 * `OPTIMIZABLE_SQL` says the same in SQL; test/integration/media-optimize.mjs
 * holds the two together on a corpus of rows.
 */
export function isOptimizable(media: OptimizableFields, maxWidth: number): boolean {
  if (media.optimized_at != null) return false;
  if (media.mime_type == null || !OPTIMIZABLE_TYPES.includes(media.mime_type)) return false;
  if (media.size_bytes == null) return false;
  if (!media.image_key.startsWith('media/')) return false;
  return (media.width ?? 0) > maxWidth || media.size_bytes > HEAVY_BYTES;
}

/** `isOptimizable()` as a WHERE clause. Binds ?1 = maxWidth, ?2 = HEAVY_BYTES. */
export const OPTIMIZABLE_SQL = `optimized_at IS NULL
   AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
   AND size_bytes IS NOT NULL
   AND substr(image_key, 1, 6) = 'media/'
   AND (COALESCE(width, 0) > ?1 OR size_bytes > ?2)`;

/** How many photos Médias offers, and what they weigh together. */
export async function optimizableSummary(
  db: D1Database,
  maxWidth: number,
): Promise<{ count: number; bytes: number }> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM media WHERE ${OPTIMIZABLE_SQL}`)
    .bind(maxWidth, HEAVY_BYTES)
    .first<{ count: number; bytes: number }>();
  return { count: row?.count ?? 0, bytes: row?.bytes ?? 0 };
}

/**
 * The next photos of a pass, after the row id the previous request stopped at.
 * The cursor is what ends a pass: a photo that fails is not marked, so without
 * it a pass would come back to that photo on every request, forever.
 */
export async function listOptimizable(
  db: D1Database,
  maxWidth: number,
  afterId: number,
  limit: number,
): Promise<Media[]> {
  const { results } = await db
    .prepare(`SELECT * FROM media WHERE ${OPTIMIZABLE_SQL} AND id > ?3 ORDER BY id LIMIT ?4`)
    .bind(maxWidth, HEAVY_BYTES, afterId, limit)
    .all<Media>();
  return results ?? [];
}

/** Photos a pass has still to reach. */
export async function countOptimizableAfter(
  db: D1Database,
  maxWidth: number,
  afterId: number,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM media WHERE ${OPTIMIZABLE_SQL} AND id > ?3`)
    .bind(maxWidth, HEAVY_BYTES, afterId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * The media row's half of the move. Binds (old key, new key, type, size,
 * width, height). `source_key` keeps the FIRST key the photo had: the one the
 * catalogue's CSV names, through any later optimization.
 */
export const MEDIA_MOVE_SQL = `UPDATE media
    SET image_key = ?2,
        mime_type = ?3,
        size_bytes = ?4,
        width = ?5,
        height = ?6,
        source_key = COALESCE(source_key, ?1),
        optimized_at = datetime('now')
  WHERE image_key = ?1`;

/**
 * Every reference's half, one statement per place a photo is named (the places
 * `deleteMediaRecord()` guards). Each binds (old key, new key) and runs only if
 * the media row now holds the new key — which only the same batch can have
 * written, keys being random — so a batch that lost a race to another
 * optimization or to a delete changes nothing.
 *
 * Unchanged, and therefore still right: the media row's id and public id (so
 * `page_media`), and the gallery rows (so a variant's photo, which points at
 * one, its position and its alt text).
 *
 * A page names a photo by its address — `/images/<key>`, or `<baseUrl>/<key>`
 * when a body was pasted from a store serving images from a domain — in its
 * body and in every zone it keeps (ADR 0031), the model in use or not. Both
 * forms hold `/<key>`, which is what is replaced.
 */
export const REFERENCE_MOVE_SQL: readonly string[] = [
  `UPDATE product_images SET image_key = ?2
    WHERE image_key = ?1 AND EXISTS (SELECT 1 FROM media WHERE image_key = ?2)`,
  `UPDATE products SET image_key = ?2
    WHERE image_key = ?1 AND EXISTS (SELECT 1 FROM media WHERE image_key = ?2)`,
  `UPDATE categories SET image_key = ?2
    WHERE image_key = ?1 AND EXISTS (SELECT 1 FROM media WHERE image_key = ?2)`,
  `UPDATE settings SET value = ?2, updated_at = datetime('now')
    WHERE key = 'logo_image_key' AND value = ?1
      AND EXISTS (SELECT 1 FROM media WHERE image_key = ?2)`,
  `UPDATE pages
      SET body_markdown = replace(body_markdown, '/' || ?1, '/' || ?2),
          zones = replace(zones, '/' || ?1, '/' || ?2)
    WHERE (instr(body_markdown, '/' || ?1) > 0 OR instr(zones, '/' || ?1) > 0)
      AND EXISTS (SELECT 1 FROM media WHERE image_key = ?2)`,
];

/** What `optimizeStoredMedia()` did with one photo. */
export type OptimizeResult =
  | { status: 'optimized'; oldKey: string; newKey: string; before: number; after: number }
  /** Processed, and too little to gain: marked, never offered again. */
  | { status: 'kept'; before: number }
  /** Not (or no longer) offered: nothing read, nothing spent. */
  | { status: 'skipped' }
  /** Nothing changed; offered again on the next pass. */
  | { status: 'failed'; reason: 'missing' | 'transform' | 'invalid' | 'conflict' };

function logFailure(key: string, reason: string, error?: unknown): void {
  console.error(
    JSON.stringify({
      event: 'media_optimize_failed',
      key,
      reason,
      ...(error === undefined ? {} : { message: logSafe(error) }),
    }),
  );
}

async function deleteQuietly(storage: StorageProvider, key: string, event: string): Promise<void> {
  try {
    await storage.delete(key);
  } catch (error) {
    // Nothing names the object any more: an orphan nobody sees, logged so it
    // can be swept by hand rather than failing the photo a second time.
    console.error(JSON.stringify({ event, key, message: logSafe(error) }));
  }
}

/**
 * Optimize one stored photo. The new object is written first and the old one
 * deleted last, so every moment between them has a row pointing at an object
 * that exists: a failure costs an orphan in the bucket at worst, never a
 * broken image.
 */
export async function optimizeStoredMedia(
  db: D1Database,
  storage: StorageProvider,
  images: ImagesBindingMin,
  media: Media,
  maxWidth: number,
): Promise<OptimizeResult> {
  if (!isOptimizable(media, maxWidth)) return { status: 'skipped' };
  const oldKey = media.image_key;
  // The row's weight is the object's: every path that writes a media row
  // records the size of the bytes it stored, and a row without one is never
  // offered. Trusting it lets the original stream from the bucket straight into
  // the binding instead of being buffered in the Worker, five megabytes a photo.
  const before = media.size_bytes ?? 0;

  const stored = await storage.get(oldKey);
  if (!stored) {
    logFailure(oldKey, 'missing');
    return { status: 'failed', reason: 'missing' };
  }

  let optimized: ArrayBuffer | null;
  try {
    optimized = await transformForStorage(images, stored.body, maxWidth);
  } catch (error) {
    // Past the Images quota (5,000 a month on the Free plan) or unreadable:
    // the photo stays as it is, and the next pass offers it again.
    logFailure(oldKey, 'transform', error);
    return { status: 'failed', reason: 'transform' };
  }
  if (!optimized) {
    logFailure(oldKey, 'transform');
    return { status: 'failed', reason: 'transform' };
  }

  if (optimized.byteLength > before * KEEP_RATIO) {
    await db.prepare(`UPDATE media SET optimized_at = datetime('now') WHERE image_key = ?1`).bind(oldKey).run();
    return { status: 'kept', before };
  }

  // The same rule as any stored file (invariant 13): the bytes say what it is.
  const file = new File([optimized], 'optimized.webp', { type: OPTIMIZED_TYPE });
  const invalid = await validateUpload(file);
  if (invalid) {
    logFailure(oldKey, 'invalid');
    return { status: 'failed', reason: 'invalid' };
  }
  const dimensions = readImageDimensions(new Uint8Array(optimized));
  const newKey = mediaKeyFor(file);

  await storage.put(newKey, optimized, OPTIMIZED_TYPE);
  let moved = false;
  try {
    const [mediaMove] = await db.batch([
      db
        .prepare(MEDIA_MOVE_SQL)
        .bind(
          oldKey,
          newKey,
          OPTIMIZED_TYPE,
          optimized.byteLength,
          dimensions?.width ?? null,
          dimensions?.height ?? null,
        ),
      ...REFERENCE_MOVE_SQL.map((sql) => db.prepare(sql).bind(oldKey, newKey)),
    ]);
    moved = (mediaMove?.meta?.changes ?? 0) > 0;
  } catch (error) {
    // A batch is atomic: nothing moved. The new object is ours alone.
    logFailure(oldKey, 'conflict', error);
    await deleteQuietly(storage, newKey, 'media_optimize_orphan');
    return { status: 'failed', reason: 'conflict' };
  }
  if (!moved) {
    // Another optimization, or a delete, got to the row first.
    logFailure(oldKey, 'conflict');
    await deleteQuietly(storage, newKey, 'media_optimize_orphan');
    return { status: 'failed', reason: 'conflict' };
  }

  // Last: nothing names the old object any more.
  await deleteQuietly(storage, oldKey, 'media_object_delete_failed');
  return { status: 'optimized', oldKey, newKey, before, after: optimized.byteLength };
}

/** What a run of optimizations did, in the terms Médias reports. */
export interface OptimizeTally {
  optimized: number;
  kept: number;
  failed: number;
  /** Weight of the optimized photos before, and after. */
  bytesBefore: number;
  bytesAfter: number;
}

export function emptyTally(): OptimizeTally {
  return { optimized: 0, kept: 0, failed: 0, bytesBefore: 0, bytesAfter: 0 };
}

/** Add one result to a tally. A skipped photo counts nowhere. */
export function tally(total: OptimizeTally, result: OptimizeResult): OptimizeTally {
  switch (result.status) {
    case 'optimized':
      return {
        ...total,
        optimized: total.optimized + 1,
        bytesBefore: total.bytesBefore + result.before,
        bytesAfter: total.bytesAfter + result.after,
      };
    case 'kept':
      return { ...total, kept: total.kept + 1 };
    case 'failed':
      return { ...total, failed: total.failed + 1 };
    default:
      return total;
  }
}

/** A tally from a query string or a form; anything unreadable counts as zero. */
export function readTally(read: (name: string) => string | null): OptimizeTally {
  const count = (name: string) => {
    const value = Number(read(name));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  };
  return {
    optimized: count('optimized'),
    kept: count('kept'),
    failed: count('failed'),
    bytesBefore: count('bytesBefore'),
    bytesAfter: count('bytesAfter'),
  };
}

/** The same tally as query parameters: what a pass carries from one request to the next. */
export function tallyParams(total: OptimizeTally): Record<string, string> {
  return {
    optimized: String(total.optimized),
    kept: String(total.kept),
    failed: String(total.failed),
    bytesBefore: String(total.bytesBefore),
    bytesAfter: String(total.bytesAfter),
  };
}

/**
 * Where Médias reports a run. `running` is a pass with photos still ahead of
 * its cursor: the page offers « Continuer » with the cursor and the tally, and
 * moves on by itself when scripting is on. `done` is the final count.
 */
export function optimizeResultHref(report: {
  state: 'running' | 'done';
  total: OptimizeTally;
  after?: number;
  remaining?: number;
  page?: number;
}): string {
  return queryHref('/admin/media', {
    optimize: report.state,
    ...tallyParams(report.total),
    after: report.state === 'running' ? report.after : undefined,
    remaining: report.state === 'running' ? report.remaining : undefined,
    page: report.page && report.page > 1 ? report.page : undefined,
  });
}

/** A non-negative integer from a form or a query string, 0 otherwise. */
export function readCursor(value: unknown): number {
  const number = Number(typeof value === 'string' ? value : NaN);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}
