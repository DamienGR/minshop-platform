import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import type { ThemeTextWrite } from './slots.ts';

/**
 * What the merchant wrote over the theme's defaults (migration 0054). A small
 * table — one row per edited slot, fifty slots at most per theme — read whole.
 */
export function themeTextsStatement(db: D1Database): D1PreparedStatement {
  return db.prepare('SELECT key, value FROM theme_texts');
}

export function themeTextMap(rows: Array<{ key: string; value: string }>): Map<string, string> {
  return new Map(rows.map((row) => [row.key, row.value]));
}

export async function readThemeTexts(db: D1Database): Promise<Map<string, string>> {
  const { results } = await themeTextsStatement(db).all<{ key: string; value: string }>();
  return themeTextMap(results ?? []);
}

/** Every write of one save in one batch: a form is saved whole or not at all. */
export async function saveThemeTexts(db: D1Database, writes: ThemeTextWrite[]): Promise<void> {
  if (writes.length === 0) return;
  await db.batch(
    writes.map(({ key, value }) =>
      value === null
        ? db.prepare('DELETE FROM theme_texts WHERE key = ?').bind(key)
        : db
            .prepare(
              `INSERT INTO theme_texts (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            )
            .bind(key, value),
    ),
  );
}
