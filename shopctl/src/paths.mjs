/**
 * Where the core this CLI belongs to lives.
 *
 * Resolved from the module's own location, never from the working directory:
 * `shopctl new` runs from wherever the operator keeps their shops, and
 * `shopctl config validate` runs inside a shop. Both need the core that ships
 * the CLI — the same tree that carries the gates it wraps — and only
 * `import.meta.url` knows which one that is.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CORE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The core's package manifest. Its `version` is shopctl's version too: the CLI
 *  that creates a shop from tag v1.2.0 is the one that tag ships. */
export function corePackage() {
  return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
}
