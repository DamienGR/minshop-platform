// Explicit .ts: several integration scripts load this chain through Node's
// type stripping, which does not resolve extensionless relative imports.
import { redactAccessTokens } from '../ids/token.ts';

/**
 * What a log line is allowed to carry.
 *
 * Almost everything this store logs is already a structured event it wrote
 * itself, with fields it chose. The exception is the error path: `catch (err)`
 * hands the log an object built somewhere else, and on the paths that matter —
 * email, payment, refunds — "somewhere else" is a provider, answering about a
 * customer. Resend's 422 body names the recipient it refused. A payment
 * provider's error can carry the shipping address it validated. Passed straight
 * to `console.error`, that is a customer's address in a log an operator, a
 * support tool, and every log sink downstream can read — and logs outlive the
 * order.
 *
 * So an error crossing into a log goes through here. Two things are masked:
 *
 *  - **e-mail addresses**, the one piece of personal data with a shape a
 *    regular expression can actually recognize;
 *  - **guest access tokens**, which are bearer credentials for an order — the
 *    redaction `features/ids/token.ts` declares authoritative and, until now,
 *    nothing in the store called.
 *
 * It is deliberately NOT a general PII detector: a street address has no shape,
 * and a filter that pretended to find one would be trusted for something it
 * cannot do. Free-form provider text is kept OUT of the message at the source
 * instead (see features/email/resend.ts); this is the second layer, for the
 * adapters that have not been audited one by one.
 *
 * The stack is dropped with the rest. Every caller is a `catch` around one
 * awaited provider call, so the stack says only which of our own frames
 * awaited it — which the log message already says by hand.
 */

/** Anything@anything.tld, conservatively bounded so it cannot eat a whole line. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** The longest a redacted provider message may be. Beyond this it is noise. */
const MAX_LENGTH = 300;

/** A log-safe rendering of anything a `catch` can receive. */
export function logSafe(value: unknown): string {
  const text =
    value instanceof Error
      ? value.message || value.name
      : typeof value === 'string'
        ? value
        : safeStringify(value);
  const redacted = redactAccessTokens(text).replace(EMAIL_RE, '<email>');
  return redacted.length > MAX_LENGTH ? `${redacted.slice(0, MAX_LENGTH)}…` : redacted;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
