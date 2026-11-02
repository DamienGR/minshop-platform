import type { StoreSettings } from '../settings/db';
import { emailConfigured, type RuntimeCapabilities } from '../settings/availability.ts';
import { ownerAlertRecipient } from '../email/orderPolicy.ts';
import { contactReasons, isContactAddress } from './form.ts';

/**
 * Where the contact form is, who receives it, and what it offers — or null
 * when the store has no form to show (ADR 0025).
 *
 * The form sits under ONE published page the merchant chooses. That page is
 * what the navigation links to, what the sitemap lists and what the theme's
 * ContentPage frames; the form needs nothing of its own from any of them.
 *
 * A form nobody would receive is not shown: the page is set, e-mail is on and
 * configured, and a recipient exists (the form's own, or the order alerts').
 * Checked from settings alone, like the Admin's availability chips, so the
 * page does not decrypt a provider key to decide whether to render a form.
 */
export interface ContactSettings {
  pageId: number;
  to: string;
  reasons: string[];
}

export function contactSettings(
  settings: StoreSettings | undefined,
  configNotifyTo: string,
  caps: Pick<RuntimeCapabilities, 'vault' | 'emailBinding'>,
): ContactSettings | null {
  if (!settings?.contactPageId) return null;
  const to = contactRecipient(settings, configNotifyTo);
  if (!to) return null;
  if (!emailConfigured(settings, caps)) return null;
  return { pageId: settings.contactPageId, to, reasons: contactReasons(settings.contactReasons) };
}

/** The address a message goes to, or '' when there is none worth sending to. */
export function contactRecipient(
  settings: Pick<StoreSettings, 'contactTo' | 'emailNotifyTo'>,
  configNotifyTo: string,
): string {
  const to = (settings.contactTo || ownerAlertRecipient(settings.emailNotifyTo, configNotifyTo)).trim();
  return isContactAddress(to) ? to : '';
}
