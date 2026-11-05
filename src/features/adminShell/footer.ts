import { version } from '../../../package.json';

/**
 * The Admin's footer (ticket #186): which core the shop runs, and whom to ask
 * when something goes wrong.
 *
 * The version is `package.json`'s, a core file: a shop never edits it, and
 * `shopctl core upgrade` merges the core's, so the footer names the release the
 * shop actually carries. A named import: Vite bundles that one field, not the
 * dependency list around it.
 */
export const CORE_VERSION: string = version;

/** One address, no spaces, no separators: enough to refuse a typo that would
 *  make the link write to two people, or to nobody. */
const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>".]+$/;

/**
 * The help link's `mailto:`, with a subject that tells the support which shop
 * and which version wrote — or null when the shop declares no address (or one
 * that is not an address), and the footer then shows no link.
 */
export function supportHref(address: string, subject: string): string | null {
  const to = address.trim();
  if (!ADDRESS.test(to)) return null;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}`;
}
