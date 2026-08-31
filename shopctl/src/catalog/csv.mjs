/**
 * RFC 4180, and nothing beyond it.
 *
 * The catalogue arrives as a file a human maintains in a spreadsheet, so the
 * parser has to survive what spreadsheets emit rather than what a well-formed
 * generator would: a UTF-8 BOM at the head of the file (Excel writes one and
 * makes the first column name `﻿sku`, which then matches no column at
 * all), CRLF line endings, a quoted field holding a comma, a newline or a
 * doubled quote, and a trailing newline that is not an empty row.
 *
 * Splitting on commas and stripping quotes afterwards fails on the second of
 * those and corrupts a product description in a way nobody reads back — so this
 * walks the bytes once, in a state machine, and refuses malformed quoting
 * instead of guessing. A CSV that cannot be parsed unambiguously is a file the
 * merchant has to fix; guessing at it would write the guess into the store.
 *
 * No dependency, like everything else in this CLI (plan §5.1): `shopctl` runs
 * before a `node_modules` exists.
 */

/** What the parser refuses on, carrying the position a human can navigate to. */
export class CsvError extends Error {
  /**
   * @param {string} message
   * @param {{ line: number, column: number }} at 1-based, as an editor counts
   */
  constructor(message, at) {
    super(message);
    this.name = 'CsvError';
    this.at = at;
  }
}

/**
 * Parse a delimited document into rows of raw strings.
 *
 * Values are returned exactly as written, whitespace included: trimming is a
 * decision about a COLUMN — a description keeps its indentation, a SKU does not
 * — so it belongs to the contract (contract.mjs), not here.
 *
 * @param {string} text the whole file
 * @param {{ delimiter?: string }} [options]
 * @returns {Array<{ line: number, values: string[] }>} one entry per record,
 *   `line` being where the record STARTS (a quoted newline keeps the record's
 *   own first line, which is the one a reader is looking for)
 */
export function parseCsv(text, { delimiter = ',' } = {}) {
  if (delimiter.length !== 1) throw new TypeError('the delimiter must be a single character.');

  // The BOM belongs to the encoding, not to the first field.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  /** @type {Array<{ line: number, values: string[] }>} */
  const records = [];
  let values = [];
  let field = '';
  let quoted = false;
  let started = false; // this record has at least one field, even if empty
  let line = 1;
  let column = 1;
  let recordLine = 1;

  const pushField = () => {
    values.push(field);
    field = '';
    started = true;
  };
  const pushRecord = () => {
    // A trailing newline ends the last record; it does not begin an empty one.
    if (started || values.length > 0) records.push({ line: recordLine, values });
    values = [];
    started = false;
    recordLine = line;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
          column += 2;
          continue;
        }
        quoted = false;
        column += 1;
        continue;
      }
      if (char === '\n') {
        field += '\n';
        line += 1;
        column = 1;
        continue;
      }
      // A lone CR inside quotes belongs to a CRLF the field genuinely contains;
      // normalise it so a value never carries the file's line-ending style.
      if (char === '\r') {
        if (source[index + 1] === '\n') continue;
        field += '\r';
        column += 1;
        continue;
      }
      field += char;
      column += 1;
      continue;
    }

    if (char === '"') {
      if (field !== '') {
        throw new CsvError(
          'un guillemet ouvre au milieu d\'une valeur non guillemetée ; guillemetez la valeur entière, ou doublez le guillemet pour le garder tel quel.',
          { line, column },
        );
      }
      quoted = true;
      started = true;
      column += 1;
      continue;
    }
    if (char === delimiter) {
      pushField();
      column += 1;
      continue;
    }
    if (char === '\n' || char === '\r') {
      pushField();
      pushRecord();
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      line += 1;
      column = 1;
      recordLine = line;
      continue;
    }
    field += char;
    column += 1;
  }

  if (quoted) {
    throw new CsvError('le fichier se termine à l\'intérieur d\'une valeur guillemetée ; il manque un guillemet fermant.', { line, column });
  }
  if (field !== '' || started) {
    pushField();
    pushRecord();
  }

  return records;
}

/**
 * Which character separates the fields.
 *
 * A French spreadsheet writes `;`, and not by accident: the decimal separator is
 * a comma, so a comma-delimited export would need every price quoted, and the
 * moment one is not the row silently shifts by a column. Excel and LibreOffice
 * both follow the system locale here, which means the file a merchant sends is
 * semicolon-delimited far more often than not.
 *
 * Decided on the HEADER line alone, where the answer is unambiguous: no column
 * name of this contract contains either character, so whichever appears there is
 * the delimiter. Sniffing over the whole file would let a description full of
 * commas outvote the header and re-introduce exactly the corruption this avoids.
 */
export function sniffDelimiter(text) {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const header = source.split(/\r?\n/, 1)[0] ?? '';
  const semicolons = (header.match(/;/g) ?? []).length;
  const commas = (header.match(/,/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

/**
 * Parse into records keyed by the header row.
 *
 * Two shapes of malformed file are refused here rather than surfacing later as
 * a puzzling missing value: a duplicate column name (which of the two wins is
 * not a question a store should answer silently) and a row whose width differs
 * from the header's (a stray comma in an unquoted description shifts every
 * value after it into the wrong column, which is exactly the corruption that
 * reads as valid).
 *
 * @param {string} text
 * @param {{ delimiter?: string }} [options]
 * @returns {{ columns: string[], delimiter: string, rows: Array<{ line: number, cells: Record<string,string> }> }}
 */
export function parseCsvRecords(text, options = {}) {
  const delimiter = options.delimiter ?? sniffDelimiter(text);
  const records = parseCsv(text, { ...options, delimiter });
  if (records.length === 0) throw new CsvError('le fichier est vide ; une ligne d\'en-tête est obligatoire.', { line: 1, column: 1 });

  const [header, ...rest] = records;
  const columns = header.values.map((value) => value.trim());

  const seen = new Set();
  for (const [index, name] of columns.entries()) {
    if (!name) throw new CsvError(`la colonne ${index + 1} de l'en-tête n'a pas de nom.`, { line: header.line, column: index + 1 });
    if (seen.has(name)) throw new CsvError(`la colonne « ${name} » apparaît deux fois dans l'en-tête.`, { line: header.line, column: index + 1 });
    seen.add(name);
  }

  const rows = [];
  for (const record of rest) {
    // A row of one empty field is a blank line between sections of the file, not
    // a product with every value missing.
    if (record.values.length === 1 && record.values[0].trim() === '') continue;
    if (record.values.length !== columns.length) {
      throw new CsvError(
        `cette ligne porte ${record.values.length} valeurs alors que l'en-tête en déclare ${columns.length}.`,
        { line: record.line, column: 1 },
      );
    }
    rows.push({ line: record.line, cells: Object.fromEntries(columns.map((name, index) => [name, record.values[index]])) });
  }

  return { columns, delimiter, rows };
}
