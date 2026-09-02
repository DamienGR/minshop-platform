import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SECURITY_HEADERS,
  DEFAULT_REFERRER_POLICY,
} from '../../src/features/http/securityHeaders.ts';

/**
 * The static half of the store.
 *
 * Cloudflare's asset server answers /favicon.svg, /placeholder.* and everything
 * under /_astro/ before the Worker runs, so those responses never pass through
 * src/middleware.ts. `public/_headers` is the only way to harden them, which
 * makes it a second copy of the list — and a second copy nobody checks is a
 * copy that falls behind the first. This is the check.
 *
 * It lives here rather than beside the module because it reads a file, and the
 * unit suite under src/ is compiled without node types on purpose.
 *
 * The `_headers` format is Cloudflare's: a path pattern on its own line, then
 * indented `Name: value` lines. Parsed the same way here; the BUILT copy, with
 * the adapter's generated rule appended, is checked by the security gate.
 */
function parseHeadersFile(path) {
  const rules = new Map();
  let current = null;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      rules.set(line.trim(), current);
      continue;
    }
    const separator = line.indexOf(':');
    if (separator < 0 || !current) continue;
    current.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
  }
  return rules;
}

describe('public/_headers', () => {
  const rules = parseHeadersFile('public/_headers');

  it('hardens every static asset the Worker never sees', () => {
    const all = rules.get('/*');
    expect(all, 'public/_headers declares no /* rule').toBeDefined();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(all.get(name), `static assets are served without ${name}`).toBe(value);
    }
    expect(all.get('referrer-policy')).toBe(DEFAULT_REFERRER_POLICY);
  });

  it('leaves the /_astro/* cache rule to the adapter, which appends its own', () => {
    // Two rules for one path would put this file in competition with the
    // adapter's generated line, and the winner is decided by build order.
    expect(rules.has('/_astro/*')).toBe(false);
  });
});
