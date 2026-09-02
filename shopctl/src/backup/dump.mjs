/**
 * Turning rows into bytes, and bytes into a number you can compare.
 *
 * Everything here is pure. A backup's whole claim — "this archive holds what
 * the database held" — rests on a digest, and a digest is only worth something
 * if two runs over the same rows produce the same one. That is what
 * `canonical()` buys: JSON.stringify preserves INSERTION order of keys, and
 * `wrangler d1 execute --json` builds its row objects from whatever order the
 * driver hands back. Two dumps of an unchanged table would then differ in
 * bytes and agree in content, and a verification that cries wolf is a
 * verification people stop running.
 *
 * Rows are sorted before they are hashed, for the same reason one step up:
 * a restore re-inserts rows and SQLite is free to hand them back in another
 * order. What has to match before and after a restore is the SET of rows, and
 * that is what the digest names.
 *
 * `literal()` is the other half, and it is the security surface: a restore
 * hands D1 a FILE of statements (one round trip instead of one per row), so
 * every value is inlined. The quoting is the catalogue's — single quotes
 * doubled, NUL refused outright — and it is deliberately the same rule rather
 * than a second opinion about it. What this file adds is the types a full dump
 * meets that a catalogue import does not: floats, bigints and blobs.
 */
import { createHash } from 'node:crypto';

/** A JSON rendering whose bytes depend on the VALUE, never on key order. */
export function canonical(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return `"${value}"`;
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value instanceof Uint8Array) return `"b64:${Buffer.from(value).toString('base64')}"`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(',')}}`;
}

export function digest(input) {
  return createHash('sha256').update(typeof input === 'string' ? Buffer.from(input, 'utf8') : input).digest('hex');
}

/**
 * One table's fingerprint.
 *
 * The name is in it: two tables with identical contents are not the same
 * table, and a manifest that said they were would let a restore into the wrong
 * one pass its own comparison.
 */
export function tableDigest({ name, columns, rows }) {
  const sorted = [...rows].map(canonical).sort();
  return digest(canonical({ name, columns: [...columns] }) + '\n' + sorted.join('\n'));
}

/**
 * An identifier this module is willing to inline.
 *
 * Table and column names come from `sqlite_master`, which is as trustworthy as
 * whoever ran the last migration — but a restore builds SQL text out of them,
 * and "it came from the database" is exactly the reasoning that makes an
 * injection through a schema possible. The pattern is what a migration in this
 * repository can produce; anything else stops the run rather than being quoted
 * cleverly.
 */
export function identifier(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name))) {
    throw new Error(`« ${name} » n'est pas un identifiant SQL que la sauvegarde sait écrire.`);
  }
  return `"${name}"`;
}

/** One value, as a SQLite literal. */
export function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`une valeur non finie (${value}) ne peut pas être écrite en SQL.`);
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value === 'string') {
    if (value.includes('\0')) throw new Error('une valeur contient un octet NUL, qui ne peut pas être écrit en littéral SQL.');
    return `'${value.replaceAll("'", "''")}'`;
  }
  // D1 hands a BLOB back as an array of byte values; node:sqlite hands one back
  // as a Uint8Array. Both become the same hex literal, which is what makes an
  // archive taken through one readable by a restore through the other.
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return `X'${Buffer.from(value).toString('hex')}'`;
  }
  throw new Error(`la sauvegarde ne sait pas écrire une valeur de type ${typeof value}.`);
}

/** How many rows go into one INSERT. Small enough that a failure names a few
 *  rows rather than a table; large enough that a file stays a file. */
export const ROWS_PER_INSERT = 50;

/**
 * The INSERT statements that put one table's rows back.
 *
 * `skip` is for the columns SQLite computes: a generated column comes back from
 * `SELECT *` like any other and is refused by an INSERT that names it.
 */
export function insertStatements({ name, columns, rows, skip = [] }) {
  const written = columns.filter((column) => !skip.includes(column));
  if (rows.length === 0 || written.length === 0) return [];
  const table = identifier(name);
  const columnList = written.map(identifier).join(', ');
  const statements = [];
  for (let index = 0; index < rows.length; index += ROWS_PER_INSERT) {
    const chunk = rows.slice(index, index + ROWS_PER_INSERT);
    const values = chunk.map((row) => `(${written.map((column) => literal(row[column])).join(', ')})`);
    statements.push(`INSERT INTO ${table} (${columnList}) VALUES\n  ${values.join(',\n  ')};`);
  }
  return statements;
}

/**
 * The script that replaces a database's business data with an archive's.
 *
 * Deletes run in REVERSE dependency order and inserts in dependency order, so
 * neither half ever asks a foreign key to point at a row that is not there
 * yet or has just gone. `PRAGMA defer_foreign_keys` would paper over an
 * ordering mistake; ordering the statements means the mistake cannot be made.
 */
export function restoreScript({ order, tables, generated = {} }) {
  const statements = [];
  for (const name of [...order].reverse()) {
    if (tables[name]) statements.push(`DELETE FROM ${identifier(name)};`);
  }
  for (const name of order) {
    const table = tables[name];
    if (table) statements.push(...insertStatements({ name, columns: table.columns, rows: table.rows, skip: generated[name] ?? [] }));
  }
  return statements;
}
