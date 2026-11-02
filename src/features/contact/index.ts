import { env } from 'cloudflare:workers';
import { getConfig } from '../../config';
import type { StoreSettings } from '../settings/db';
import { getEmailProvider } from '../email';
import { contactMessageEmail } from '../email/contactMessage';
import { getSecret } from '../secrets/store';
import { TURNSTILE_FIELD, verifyConfiguredTurnstile } from '../auth/turnstile';
import { logSafe } from '../observability/logSafe';
import type { MessageKey } from '../i18n';
import {
  readContactForm,
  validateContact,
  type ContactErrors,
  type ContactValues,
} from './form';
import type { ContactSettings } from './policy';

export { contactSettings, type ContactSettings } from './policy';

/**
 * What a contact submission came to.
 *
 * `sent` is also the answer to a filled trap: the robot is shown the same
 * confirmation as a person, and nothing leaves the Worker. Every refusal hands
 * back what the visitor typed, so the page can put it in front of them again —
 * nothing is stored (ADR 0025), and the form is the only copy of the message
 * until the merchant's inbox has one.
 */
export type ContactOutcome =
  | { kind: 'sent' }
  | {
      kind: 'refused';
      status: number;
      values: ContactValues;
      errors: ContactErrors;
      formError: MessageKey | null;
    };

const EMPTY: ContactValues = { name: '', email: '', phone: '', reason: '', message: '' };

/**
 * Check and send one message. The order is the cheapest refusal first: the
 * trap, the bot challenge (when it is on), the fields, then the provider.
 *
 * The log carries events and never a field: not the name, the address, the
 * reason or the message (invariant 12). A provider's error goes through
 * logSafe, and Resend's adapter already keeps its body out of the message.
 */
export async function submitContact(
  request: Request,
  contact: ContactSettings,
  settings: StoreSettings,
  pageUrl: string,
): Promise<ContactOutcome> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { kind: 'refused', status: 400, values: EMPTY, errors: {}, formError: 'contact.error.unreadable' };
  }
  const { values, trapped } = readContactForm(form);
  if (trapped) {
    console.log(JSON.stringify({ event: 'contact_trapped' }));
    return { kind: 'sent' };
  }

  const turnstileEnabled = settings.turnstileEnabled === true;
  const passed = await verifyConfiguredTurnstile(
    turnstileEnabled,
    form.get(TURNSTILE_FIELD)?.toString(),
    turnstileEnabled ? await getSecret(env.DB, 'turnstile_secret_key') : null,
    request.headers.get('CF-Connecting-IP'),
  );
  if (!passed) {
    return { kind: 'refused', status: 400, values, errors: {}, formError: 'contact.error.verification' };
  }

  const checked = validateContact(values, contact.reasons);
  if (!checked.ok) {
    return { kind: 'refused', status: 400, values, errors: checked.errors, formError: null };
  }

  const emailer = await getEmailProvider(settings);
  if (!emailer) {
    // The page showed the form from settings alone; the key behind them is
    // gone or unreadable. Same answer as a failed send: the text stays.
    console.error(JSON.stringify({ event: 'contact_unavailable' }));
    return { kind: 'refused', status: 503, values, errors: {}, formError: 'contact.error.sendFailed' };
  }
  const storeName = settings.storeName ?? getConfig().storeName;
  try {
    await emailer.send(contactMessageEmail(checked.message, contact.to, storeName, pageUrl));
  } catch (err) {
    console.error(JSON.stringify({ event: 'contact_send_failed', error: logSafe(err) }));
    return { kind: 'refused', status: 503, values, errors: {}, formError: 'contact.error.sendFailed' };
  }
  console.log(JSON.stringify({ event: 'contact_sent' }));
  return { kind: 'sent' };
}
