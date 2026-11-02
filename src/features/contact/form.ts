import { t, type MessageKey } from '../i18n/index.ts';

/**
 * The contact form's fields and the rules a message must pass (ticket #147,
 * ADR 0025). Pure: no binding, no D1, so the rules are unit-tested here and the
 * page, the e-mail and the settings screen all read the same ones.
 *
 * Nothing is truncated. A message too long, a name with a line break, a reason
 * that is not in the list: the form comes back with the visitor's text and says
 * which field, because a message cut short is a message the merchant reads
 * wrong without knowing it.
 */

/** The fields a visitor fills, in the order the form shows them. */
export const CONTACT_FIELDS = ['name', 'email', 'phone', 'reason', 'message'] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

/**
 * The trap: a field hidden from people (off-screen, out of the tab order, out
 * of the accessibility tree) that a robot filling every input fills too. A
 * submission that fills it is answered like a sent one and sent nowhere, so
 * the robot learns nothing to adapt to.
 */
export const CONTACT_TRAP_FIELD = 'website';

/** Maximum lengths, in characters. The page puts the same ones in `maxlength`. */
export const CONTACT_LIMITS = {
  name: 100,
  // RFC 5321's path limit: an address longer than this cannot be delivered.
  email: 254,
  phone: 30,
  message: 5000,
  /** One reason in the merchant's list. */
  reason: 60,
  /** How many reasons the list may hold. */
  reasons: 10,
} as const;

export type ContactValues = Record<ContactField, string>;
export type ContactErrors = Partial<Record<ContactField, MessageKey>>;

export type ContactValidation =
  | { ok: true; message: ContactValues }
  | { ok: false; errors: ContactErrors };

/** The reasons a store offers until its merchant writes its own. */
const DEFAULT_REASON_KEYS = [
  'contact.reason.default.info',
  'contact.reason.default.order',
  'contact.reason.default.quote',
  'contact.reason.default.complaint',
  'contact.reason.default.other',
] as const satisfies readonly MessageKey[];

export function defaultContactReasons(): string[] {
  return DEFAULT_REASON_KEYS.map((key) => t(key));
}

/** The list the form offers: the merchant's, or the defaults. */
export function contactReasons(stored: readonly string[] | null | undefined): string[] {
  return stored && stored.length > 0 ? [...stored] : defaultContactReasons();
}

// C0 and C1 controls and DEL. A tab in a message is kept; nothing else of
// the kind has a reason to be in a form field, and in a header it is how a
// line break gets in.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const LINE_CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+().\s-]+$/;

/** Characters, not UTF-16 units: an emoji counts as one, as the visitor sees it. */
const length = (value: string): number => [...value].length;

/** What the form posted, each field as typed (lines normalised), never undefined. */
export function readContactForm(form: FormData): { values: ContactValues; trapped: boolean } {
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const values = Object.fromEntries(
    CONTACT_FIELDS.map((name) => [name, field(name).replace(/\r\n?/g, '\n')]),
  ) as ContactValues;
  return { values, trapped: field(CONTACT_TRAP_FIELD).trim() !== '' };
}

/**
 * Check a message against the rules and the reasons on offer. On success the
 * values come back trimmed, which is what the e-mail carries.
 */
export function validateContact(
  values: ContactValues,
  reasons: readonly string[],
): ContactValidation {
  const name = values.name.trim();
  const email = values.email.trim();
  const phone = values.phone.trim();
  const reason = values.reason.trim();
  const message = values.message.trim();
  const errors: ContactErrors = {};

  if (!name) errors.name = 'contact.error.name.required';
  else if (length(name) > CONTACT_LIMITS.name) errors.name = 'contact.error.name.tooLong';
  else if (LINE_CONTROL.test(name)) errors.name = 'contact.error.name.invalid';

  if (!email) errors.email = 'contact.error.email.required';
  else if (length(email) > CONTACT_LIMITS.email || !EMAIL.test(email) || LINE_CONTROL.test(email)) {
    errors.email = 'contact.error.email.invalid';
  }

  if (phone) {
    const digits = phone.replace(/\D/g, '').length;
    if (length(phone) > CONTACT_LIMITS.phone || !PHONE.test(phone) || digits < 6) {
      errors.phone = 'contact.error.phone.invalid';
    }
  }

  if (!reason) errors.reason = 'contact.error.reason.required';
  else if (!reasons.includes(reason)) errors.reason = 'contact.error.reason.unknown';

  if (!message) errors.message = 'contact.error.message.required';
  else if (length(message) > CONTACT_LIMITS.message) errors.message = 'contact.error.message.tooLong';
  else if (CONTROL.test(message)) errors.message = 'contact.error.message.invalid';

  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, message: { name, email, phone, reason, message } };
}

export type ReasonsInput =
  | { ok: true; reasons: string[] | null }
  | { ok: false; error: MessageKey };

/**
 * The reasons the merchant typed in Admin → Réglages, one per line. Empty
 * means the defaults (null). Refused rather than trimmed to fit: the form must
 * offer what the merchant wrote, or say why it cannot.
 */
export function parseReasonsInput(text: string): ReasonsInput {
  const reasons = text
    .split(/\r\n?|\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (reasons.length === 0) return { ok: true, reasons: null };
  if (reasons.length > CONTACT_LIMITS.reasons) {
    return { ok: false, error: 'admin.settings.contact.error.tooManyReasons' };
  }
  if (reasons.some((reason) => length(reason) > CONTACT_LIMITS.reason || LINE_CONTROL.test(reason))) {
    return { ok: false, error: 'admin.settings.contact.error.reasonTooLong' };
  }
  if (new Set(reasons.map((reason) => reason.toLowerCase())).size !== reasons.length) {
    return { ok: false, error: 'admin.settings.contact.error.duplicateReason' };
  }
  return { ok: true, reasons };
}

/** Whether an address can be written into a header: one line, one address. */
export function isContactAddress(value: string): boolean {
  return length(value) <= CONTACT_LIMITS.email && EMAIL.test(value) && !LINE_CONTROL.test(value);
}
