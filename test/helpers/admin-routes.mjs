/**
 * The admin surface, derived from the route files rather than listed by hand.
 *
 * A hand-written list stops being complete the first time someone adds an
 * endpoint, and the endpoint nobody remembered to add to the gate's list is
 * exactly the one that ships unprotected. Deriving it means a new file under
 * src/pages/api/admin is covered by the next run of both security gates — the
 * one against the built Worker and the one against a deployed URL — by whoever
 * adds it, without them knowing either gate exists.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** @returns {{ path: string, verbs: string[], file: string }[]} */
export function adminRoutes(root = 'src/pages') {
  const routes = [];
  for (const base of [join(root, 'admin'), join(root, 'api/admin')]) {
    for (const file of walk(base)) {
      const rel = relative(root, file);
      const source = readFileSync(file, 'utf8');
      let path =
        '/' +
        rel
          .replace(/\.astro$/, '')
          .replace(/\.ts$/, '')
          .replace(/\/index$/, '')
          .replace(/\[\.\.\.[^\]]+\]/g, 'sample')
          .replace(/\[[^\]]+\]/g, 'sample');
      if (path.endsWith('/')) path = path.slice(0, -1);
      // An .astro page answers GET, and handles its own form posts inline; an
      // API file declares the verbs it exports.
      const verbs = file.endsWith('.astro')
        ? ['GET', 'POST']
        : VERBS.filter((verb) => new RegExp(`export const ${verb}\\b`).test(source));
      if (verbs.length > 0) routes.push({ path, verbs, file: rel });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}
