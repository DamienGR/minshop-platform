import { readdirSync, readFileSync } from 'node:fs';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

/**
 * Split a migration file into executable statements.
 *
 * D1's `exec` wants one statement per line, which no migration in this
 * repository is written as, so the file is split here and each statement is
 * prepared individually. Three things make a naive `split(';')` wrong on the
 * migrations that actually exist:
 *
 * - string literals contain semicolons (0040 ships French legal prose, and
 *   French puts a space before `;`);
 * - `--` comments are kept rather than stripped, so a statement stays readable
 *   in a failure message, and a comment's own punctuation must not terminate it;
 * - a trigger body is full of semicolons and closes only on `END;`.
 *
 * The trigger rule is the same one wrangler's remote splitter uses, and
 * test/scripts/migrations-remote-safe.test.mjs already forbids the shape that
 * would make it ambiguous — a body containing a second `END;`. That gate is
 * what lets this stay a scanner instead of a SQL parser.
 */
export function splitSql(sql) {
  const statements = [];
  let buffer = '';
  let inTrigger = false;
  let sawBegin = false;
  let i = 0;

  while (i < sql.length) {
    const pair = sql.slice(i, i + 2);
    if (pair === '--') {
      const newline = sql.indexOf('\n', i);
      const end = newline === -1 ? sql.length : newline;
      buffer += sql.slice(i, end);
      i = end;
      continue;
    }
    if (pair === '/*') {
      const close = sql.indexOf('*/', i + 2);
      const end = close === -1 ? sql.length : close + 2;
      buffer += sql.slice(i, end);
      i = end;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] !== "'") {
          j++;
          continue;
        }
        // '' is an escaped quote, not the end of the literal.
        if (sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        j++;
        break;
      }
      buffer += sql.slice(i, j);
      i = j;
      continue;
    }
    if (sql[i] === ';') {
      buffer += ';';
      i++;
      if (inTrigger && sawBegin && !/\bEND\s*;\s*$/i.test(buffer)) continue;
      statements.push(buffer);
      buffer = '';
      inTrigger = false;
      sawBegin = false;
      continue;
    }
    buffer += sql[i];
    i++;
    if (!inTrigger && /\bCREATE\s+TRIGGER\b/i.test(buffer)) inTrigger = true;
    if (inTrigger && !sawBegin && /\bBEGIN\s*$/i.test(buffer)) sawBegin = true;
  }
  if (buffer.trim()) statements.push(buffer);

  return statements.filter((statement) => hasSql(statement));
}

/** True when something other than comments and whitespace remains. */
function hasSql(statement) {
  return (
    statement
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '')
      .trim().length > 0
  );
}

/**
 * Apply every real migration, in order, to a D1 database.
 *
 * The other integration scripts hand-write the few tables they touch. That is
 * fine for a state machine tested in isolation; settlement is not isolated —
 * it writes orders, items, the item-identity registry and its triggers, stock
 * on two tables, reservations, inventory exceptions, the outbox, refunds and
 * their sync events, and reads settings and guest access on the way. A
 * hand-written subset of that is a second schema to keep in step with the
 * first, and the drift is silent: a column this suite forgot is a column the
 * suite cannot notice going wrong.
 */
export async function applyMigrations(db) {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of files) {
    const sql = readFileSync(new URL(name, MIGRATIONS), 'utf8');
    for (const statement of splitSql(sql)) {
      try {
        await db.prepare(statement).run();
      } catch (error) {
        throw new Error(`${name}: ${error.message}\n${statement.trim().slice(0, 200)}`);
      }
    }
  }
  return files.length;
}
