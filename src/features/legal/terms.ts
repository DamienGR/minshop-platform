import type { D1Database } from '@cloudflare/workers-types';

/**
 * The terms-of-sale consent gate.
 *
 * ONE predicate, read by the storefront to decide whether to render the
 * checkbox and by the server to decide whether to refuse the checkout. Two
 * predicates would eventually disagree, and both ways of disagreeing are bad:
 * a form that asks for an acceptance nobody records, or a server that refuses
 * an order the page never gave the shopper a way to accept.
 *
 * The gate is OPEN (no consent required) until the terms page is published.
 * A shop is created with the terms as an unpublished draft — see migration
 * 0040 — because the text names a company, a SIREN and a mediator that only the
 * merchant can supply. Requiring acceptance of a document nobody has written
 * would block a fresh clone from taking so much as a demo order.
 */
export interface TermsGate {
  /** Terms are published: the shopper must accept, and the server enforces it. */
  required: boolean;
  /** Where the terms live, for the checkbox's link. */
  href: string;
  /** Stamped on the order alongside the acceptance timestamp. */
  version: string;
}

export interface TermsConsent {
  version: string;
  /** ISO-8601 UTC, second precision — the same shape SQLite's datetime() writes. */
  acceptedAt: string;
}

/** The public URL of a page slug. Pure, so the form and the tests agree on it. */
export function termsHref(slug: string): string {
  return `/pages/${slug}`;
}

/**
 * Did the shopper tick the box?
 *
 * Accepts what a checkbox actually submits — an unchecked box sends nothing at
 * all, and a checked one sends its `value` — plus the shapes a JSON client
 * sends. Anything else is a refusal, including the string "false", which is
 * what a naive `Boolean(value)` would read as consent.
 */
export function isAcceptance(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'on' || normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/** The consent to record, or null when the gate is open and nothing was ticked. */
export function consentFor(gate: TermsGate, accepted: boolean): TermsConsent | null {
  if (!accepted) return null;
  return { version: gate.version, acceptedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') };
}

/**
 * Read the gate for this store. One indexed lookup on the unique slug.
 *
 * A failed read closes NOTHING: it reports the gate as open rather than
 * blocking every checkout on a transient D1 error. The consent exists to
 * evidence an agreement, and losing that evidence for one order is a smaller
 * failure than refusing to sell.
 */
export async function readTermsGate(
  db: D1Database,
  legal: { termsSlug: string; termsVersion: string },
): Promise<TermsGate> {
  const gate: TermsGate = {
    required: false,
    href: termsHref(legal.termsSlug),
    version: legal.termsVersion,
  };
  try {
    const row = await db
      .prepare('SELECT published FROM pages WHERE slug = ?')
      .bind(legal.termsSlug)
      .first<{ published: number }>();
    return { ...gate, required: row?.published === 1 };
  } catch {
    return gate;
  }
}
