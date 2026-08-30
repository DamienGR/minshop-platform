/**
 * A deliberately small YAML reader for `client/client.yaml`.
 *
 * The manifest is the one file a merchant edits by hand and the one file the
 * fleet tooling reads before touching a Cloudflare account, so it gets a
 * parser with no dependencies and no surprises. What it accepts is the shape
 * the manifest actually uses: nested mappings of scalars, two-space indent,
 * comments. Everything else — sequences, anchors, flow collections, multi-line
 * scalars, multiple documents — is REJECTED with a line number rather than
 * quietly reinterpreted.
 *
 * Rejecting is the point. A full YAML implementation would happily read
 * `market: NO` as the boolean false (the Norway problem) or resolve an anchor
 * into a value nobody typed. On a file whose values become account-level
 * resource names, "the parser did something clever" is the failure mode to
 * design out, not to document.
 *
 * Usage: parseManifestYaml(text, { file }) -> plain object. Throws Error.
 */

/** `key:` alone (a section) or `key: value`. The value is taken raw and typed
 *  below; trailing comments are stripped by the scanner, not by this regex. */
const KEY_LINE = /^([ ]*)([A-Za-z][A-Za-z0-9_-]*):(?:[ ]+(.*))?$/;

/** Two spaces per level. One convention, checked, so a file that mixes indents
 *  fails here instead of producing a differently-shaped object than it looks. */
const INDENT = 2;

/** Nesting the manifest needs is section -> field. A third level means the
 *  file has outgrown the schema, which is a schema decision, not a parse. */
const MAX_DEPTH = 2;

/**
 * Bare words a YAML 1.1 reader turns into booleans or null. Accepting them as
 * strings would make this parser disagree with every editor plugin and CI
 * linter that reads the same file; resolving them the 1.1 way would make
 * `market: NO` mean false. Refusing both is the only reading that cannot
 * silently differ from another tool.
 */
const AMBIGUOUS = new Set([
  'y', 'Y', 'yes', 'Yes', 'YES', 'n', 'N', 'no', 'No', 'NO',
  'on', 'On', 'ON', 'off', 'Off', 'OFF',
  'null', 'Null', 'NULL', '~',
  'True', 'TRUE', 'False', 'FALSE',
]);

/** Characters that open a YAML construct this reader does not implement.
 *  Caught at the start of a bare scalar so the error names the construct. */
const CONSTRUCT_START = {
  '[': 'a flow sequence',
  '{': 'a flow mapping',
  '&': 'an anchor',
  '*': 'an alias',
  '!': 'a tag',
  '|': 'a literal block scalar',
  '>': 'a folded block scalar',
  '%': 'a directive',
  '@': 'a reserved indicator',
  '`': 'a reserved indicator',
  ',': 'a flow separator',
};

class ManifestSyntaxError extends Error {
  constructor(file, line, message) {
    super(`${file}:${line}: ${message}`);
    this.name = 'ManifestSyntaxError';
    this.file = file;
    this.line = line;
  }
}

/**
 * Strip a trailing `#` comment without breaking a `#` inside quotes.
 *
 * YAML only starts a comment at a `#` that follows whitespace (or line start),
 * which is what keeps `from: a#b` a single scalar. Quote state is tracked so a
 * hash inside `"tag #1"` survives.
 */
function stripComment(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || raw[i - 1] === ' ')) return raw.slice(0, i);
  }
  return raw;
}

function parseScalar(raw, file, line, key) {
  const text = raw.trim();
  const where = `"${key}"`;
  if (text === '') {
    throw new ManifestSyntaxError(file, line, `${where} has no value. Write an explicit value, or "" for an empty string.`);
  }

  if (text.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(text)) {
      throw new ManifestSyntaxError(file, line, `${where} has an unterminated double-quoted value.`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ManifestSyntaxError(file, line, `${where} uses an escape this reader does not support. Use \\" \\\\ \\n or \\t.`);
    }
  }

  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) {
      throw new ManifestSyntaxError(file, line, `${where} has an unterminated single-quoted value.`);
    }
    return text.slice(1, -1).replaceAll("''", "'");
  }

  const construct = CONSTRUCT_START[text[0]];
  if (construct) {
    throw new ManifestSyntaxError(file, line, `${where} starts ${construct}, which the manifest format does not allow. Use a quoted scalar.`);
  }

  if (text === 'true') return true;
  if (text === 'false') return false;

  if (AMBIGUOUS.has(text)) {
    throw new ManifestSyntaxError(
      file,
      line,
      `${where} is "${text}", which different YAML readers resolve differently. Quote it ('${text}') for the string, or write true/false for the boolean.`,
    );
  }

  if (/^-?(?:0|[1-9]\d*)$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?(?:0|[1-9]\d*)\.\d+$/.test(text)) return Number.parseFloat(text);

  if (/:\s/.test(text)) {
    throw new ManifestSyntaxError(file, line, `${where} contains ": ", which reads as a nested mapping. Quote the value if the colon is part of it.`);
  }

  return text;
}

/**
 * Read the manifest.
 *
 * @param {string} text file contents
 * @param {{ file?: string }} [options] name used in error messages
 * @returns {Record<string, unknown>}
 */
export function parseManifestYaml(text, { file = 'client.yaml' } = {}) {
  const source = text.replace(/^﻿/, '');
  const lines = source.split(/\r?\n/);

  // Pass one: reject what the reader does not implement, and collect the
  // key lines with their indent. Doing this before building the object keeps
  // every "unsupported construct" error pointing at the line that used it.
  const tokens = [];
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const rawLine = lines[i];

    if (rawLine.includes('\t')) {
      throw new ManifestSyntaxError(file, lineNo, 'contains a tab. YAML indentation is spaces only.');
    }

    const line = stripComment(rawLine).replace(/[ ]+$/, '');
    if (line.trim() === '') continue;

    if (/^(---|\.\.\.)\s*$/.test(line.trim())) {
      throw new ManifestSyntaxError(file, lineNo, 'uses a document marker. The manifest is a single document; remove it.');
    }
    if (/^\s*-(\s|$)/.test(line)) {
      throw new ManifestSyntaxError(file, lineNo, 'starts a sequence. Every manifest field is a single scalar; sequences are not part of the format.');
    }

    const match = KEY_LINE.exec(line);
    if (!match) {
      throw new ManifestSyntaxError(file, lineNo, `is not "key: value". Got: ${line.trim()}`);
    }
    const [, indent, key, value] = match;
    // Block scalars are caught here rather than in parseScalar: they make the
    // lines that FOLLOW unparseable, so by the time the value is typed the
    // reader has already failed on the continuation with a worse message.
    if (value != null && /^[|>][0-9+-]*$/.test(value.trim())) {
      throw new ManifestSyntaxError(file, lineNo, `"${key}" opens a block scalar. Manifest values are single-line scalars; quote the value instead.`);
    }
    if (indent.length % INDENT !== 0) {
      throw new ManifestSyntaxError(file, lineNo, `is indented by ${indent.length} space(s). The manifest indents ${INDENT} spaces per level.`);
    }
    tokens.push({ depth: indent.length / INDENT, key, value: value ?? null, line: lineNo });
  }

  const [root, consumed] = buildMapping(tokens, 0, 0, file, []);
  if (consumed !== tokens.length) {
    // buildMapping only stops early on an indent it cannot place.
    const stray = tokens[consumed];
    throw new ManifestSyntaxError(file, stray.line, `"${stray.key}" is indented further than its parent allows.`);
  }
  return root;
}

function buildMapping(tokens, start, depth, file, path) {
  const map = {};
  const seen = new Map();
  let i = start;

  while (i < tokens.length) {
    const token = tokens[i];
    if (token.depth < depth) break;
    if (token.depth > depth) {
      throw new ManifestSyntaxError(file, token.line, `"${token.key}" is indented further than its parent allows.`);
    }

    if (seen.has(token.key)) {
      throw new ManifestSyntaxError(
        file,
        token.line,
        `"${[...path, token.key].join('.')}" is set twice (first at line ${seen.get(token.key)}). A repeated key silently discards the earlier value.`,
      );
    }
    seen.set(token.key, token.line);
    i += 1;

    if (token.value === null) {
      // A section header. Its body is whatever follows at one more level.
      if (depth + 1 > MAX_DEPTH) {
        throw new ManifestSyntaxError(file, token.line, `"${[...path, token.key].join('.')}" nests deeper than the manifest format allows (${MAX_DEPTH} levels).`);
      }
      const [child, next] = buildMapping(tokens, i, depth + 1, file, [...path, token.key]);
      if (Object.keys(child).length === 0) {
        throw new ManifestSyntaxError(file, token.line, `"${[...path, token.key].join('.')}" has no fields. Remove the section or fill it in.`);
      }
      map[token.key] = child;
      i = next;
      continue;
    }

    map[token.key] = parseScalar(token.value, file, token.line, [...path, token.key].join('.'));
  }

  return [map, i];
}
