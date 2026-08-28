#!/usr/bin/env node
/**
 * Secret scan over the tracked tree.
 *
 * A store repository is cloned per client, handed to a merchant, and kept for
 * years; a credential committed once stays in the history of every clone made
 * afterwards, and rotating it means touching every store that carries it. The
 * cheapest place to stop that is the commit that introduces it.
 *
 * What this catches, deliberately in this order:
 *
 *  1. files that must never be tracked at all (.dev.vars, .env, private keys,
 *     per-instance provisioning artifacts) — the most common way a real
 *     credential lands in a repository is a whole file, not a line;
 *  2. provider credentials by their own recognisable shape (Stripe, Resend,
 *     GitHub, AWS, Anthropic, JWTs, PEM blocks);
 *  3. a secret-looking assignment: a name that means "credential" holding a
 *     long opaque value.
 *
 * What it deliberately does NOT do: generic entropy scoring. This tree is full
 * of legitimately high-entropy strings — lockfile integrity hashes, content
 * hashes in the storefront baselines, ciphertext fixtures in the crypto tests —
 * and a scanner that cries wolf on them gets muted, which is worse than not
 * having one. Length + shape rules keep every finding actionable.
 *
 * A false positive is silenced by putting `secret-scan:ignore` on the line (or
 * the line above it), which leaves a reviewable marker in the diff instead of a
 * silent exclusion list.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const IGNORE_MARKER = 'secret-scan:ignore';

// Files whose presence in the index is itself the finding.
const FORBIDDEN_PATHS = [
  { pattern: /(^|\/)\.dev\.vars$/, why: 'local Worker secrets' },
  { pattern: /(^|\/)\.dev\.vars\.(?!example$)/, why: 'local Worker secrets' },
  { pattern: /(^|\/)\.env(\..*)?$/, why: 'environment file' },
  { pattern: /(^|\/)\.instances\//, why: 'per-instance provisioning artifact' },
  { pattern: /(^|\/)mcp\/wrangler\.jsonc$/, why: 'per-instance MCP deploy config' },
  { pattern: /\.(pem|p12|pfx|key|keystore|jks)$/, why: 'private key material' },
  { pattern: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, why: 'SSH private key' },
  { pattern: /(^|\/)\.npmrc$/, why: 'may carry a registry token', allow: [/^\.npmrc$/, /^mcp\/\.npmrc$/] },
];

// Binary and generated content: nothing here is hand-written, and scanning it
// only produces noise.
const SKIP_CONTENT = [
  /\.(png|jpe?g|gif|ico|webp|avif|woff2?|ttf|eot|pdf|zip|gz)$/,
  /(^|\/)package-lock\.json$/,
];

const RULES = [
  { name: 'Stripe secret key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}/ },
  { name: 'Stripe webhook secret', pattern: /\bwhsec_[A-Za-z0-9]{20,}/ },
  { name: 'Resend API key', pattern: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/ },
  { name: 'GitHub token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'AWS access key id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenNode API key', pattern: /\bopennode_[A-Za-z0-9]{20,}/ },
  { name: 'Private key block', pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { name: 'JSON Web Token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  {
    name: 'Credential-shaped assignment',
    // NAME = "<24+ opaque chars>". Requires the value to look like a key, not a
    // sentence: no spaces, and a mix that rules out plain identifiers.
    pattern:
      /\b(?:[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|APIKEY|KEK|CREDENTIAL)[A-Z0-9_]*)\s*[:=]\s*["'`]([A-Za-z0-9+/=_-]{24,})["'`]/,
    // A placeholder is not a credential, and neither is a test fixture spelled
    // out in words: these are the shapes the repository uses on purpose in
    // examples, templates and unit tests (`'a-high-entropy-key-…'`). A real key
    // is opaque — it does not read as three hyphenated English words.
    allowValue:
      /^(?:[Xx]+|0+|<.*>|__[A-Z_]+__|your[-_]|change[-_]?me|replace|example|placeholder|unused|[a-z]+(?:[-_][a-z]+){2,}$)/,
  },
];

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const findings = [];

// ---------------------------------------------------------------------------
// 1. Files that must not be tracked.

for (const file of tracked) {
  for (const { pattern, why, allow } of FORBIDDEN_PATHS) {
    if (!pattern.test(file)) continue;
    if (allow?.some((exception) => exception.test(file))) continue;
    findings.push({ file, line: 0, rule: `tracked file (${why})`, excerpt: file });
  }
}

// ---------------------------------------------------------------------------
// 2 & 3. Content rules.

function redact(match) {
  // Show enough to locate the value, never enough to use it.
  return match.length <= 12 ? match : `${match.slice(0, 8)}…${match.slice(-4)}`;
}

for (const file of tracked) {
  if (SKIP_CONTENT.some((pattern) => pattern.test(file))) continue;

  const path = resolve(root, file);
  let stats;
  try {
    stats = statSync(path);
  } catch {
    continue; // Tracked but absent from the working tree (e.g. a sparse checkout).
  }
  if (!stats.isFile() || stats.size > 2_000_000) continue;

  const source = readFileSync(path, 'utf8');
  if (source.includes('\0')) continue; // Binary without a known extension.

  const lines = source.split('\n');
  lines.forEach((line, index) => {
    if (line.includes(IGNORE_MARKER)) return;
    if (index > 0 && lines[index - 1].includes(IGNORE_MARKER)) return;

    for (const { name, pattern, allowValue } of RULES) {
      const match = pattern.exec(line);
      if (!match) continue;
      if (allowValue && allowValue.test(match[1] ?? '')) continue;
      findings.push({ file, line: index + 1, rule: name, excerpt: redact(match[0]) });
    }
  });
}

if (findings.length) {
  console.error(`✗ secret scan: ${findings.length} finding(s)\n`);
  for (const { file, line, rule, excerpt } of findings) {
    console.error(`  ${file}${line ? `:${line}` : ''}  ${rule}\n    ${excerpt}`);
  }
  console.error(
    '\nA real credential must be ROTATED, not just removed — it is already in the history.\n' +
      `A false positive is silenced with a \`${IGNORE_MARKER}\` comment on the line.`,
  );
  process.exit(1);
}

console.log(`✓ secret scan: ${tracked.length} tracked files, no credential found`);
