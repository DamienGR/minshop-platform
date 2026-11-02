import type { EmailMessage } from './provider';
import { PALETTE, emailLabel, emailShell, escapeHtml } from './layout.ts';
import type { ContactValues } from '../contact/form.ts';
import { t } from '../i18n/index.ts';

/**
 * The message a visitor wrote on the contact form, to the merchant (ADR 0025).
 *
 * Sent FROM the store and answered TO the visitor: `replyTo` carries their
 * address, so the merchant's « Répondre » writes to them. The address is the
 * one the form validated, bare, never with the name in front of it: a display
 * name is free text, and free text has no place in a header.
 *
 * Everything the visitor typed is escaped in the HTML part, the message's line
 * breaks kept; the text part carries it as written. The subject names the
 * reason first, so an inbox sorts « Sur mesure » from « Réclamation ».
 */
export function contactMessageEmail(
  message: ContactValues,
  to: string,
  storeName: string,
  pageUrl: string,
): EmailMessage {
  const subject = t('email.contact.subject', { motif: message.reason, nom: message.name });
  const rows: [string, string][] = [
    [t('email.contact.name'), message.name],
    [t('email.contact.email'), message.email],
    ...(message.phone ? ([[t('email.contact.phone'), message.phone]] as [string, string][]) : []),
    [t('email.contact.reason'), message.reason],
  ];

  const text = [
    t('email.contact.intro', { boutique: storeName }),
    '',
    ...rows.map(([libelle, valeur]) => t('email.contact.line', { libelle, valeur })),
    '',
    t('email.contact.messageLine'),
    message.message,
    '',
    t('email.contact.reply', { nom: message.name }),
    t('email.contact.pageLine', { url: pageUrl }),
  ].join('\n');

  const html = emailShell({
    storeName,
    heading: t('email.contact.heading'),
    subheading: escapeHtml(message.reason),
    body:
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;border-collapse:collapse;">` +
      rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:4px 16px 4px 0;font-size:13px;color:${PALETTE.muted};vertical-align:top;">${escapeHtml(label)}</td>` +
            `<td style="padding:4px 0;font-size:14px;">${escapeHtml(value)}</td></tr>`,
        )
        .join('') +
      `</table>` +
      emailLabel(t('email.contact.message')) +
      `<p style="margin:0;font-size:14px;line-height:1.6;">${escapeHtml(message.message).replace(/\n/g, '<br>')}</p>`,
    footer: `${escapeHtml(t('email.contact.reply', { nom: message.name }))}<br>${escapeHtml(t('email.contact.page'))} <a href="${escapeHtml(pageUrl)}" style="color:${PALETTE.muted};">${escapeHtml(pageUrl)}</a>`,
  });

  return { to, subject, html, text, replyTo: message.email };
}
