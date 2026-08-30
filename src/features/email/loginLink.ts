import type { EmailMessage } from './provider';
import { PALETTE, emailShell, emailButton, escapeHtml } from './layout';
import { t } from '../i18n';

/** Passwordless sign-in email — a single-use, short-lived magic link. */
export function loginLinkEmail(to: string, link: string, storeName: string): EmailMessage {
  const subject = t('email.login.subject', { boutique: storeName });
  const text = [
    t('email.login.text', { boutique: storeName }),
    ``,
    link,
    ``,
    t('email.login.textExpiry'),
  ].join('\n');
  const html = emailShell({
    storeName,
    heading: t('email.login.heading'),
    subheading: t('email.login.subheading'),
    body:
      emailButton(link, t('email.login.button')) +
      `<p style="margin:0;font-size:12px;line-height:1.6;color:${PALETTE.muted};">
        ${escapeHtml(t('email.login.fallback'))}<br>
        <a href="${link}" style="color:${PALETTE.muted};word-break:break-all;">${link}</a>
      </p>`,
    footer: t('email.login.footer'),
  });
  return { to, subject, html, text };
}
