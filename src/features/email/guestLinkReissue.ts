import { getConfig } from '../../config';
import type { Order } from '../orders/db';
import { orderReference } from '../orders/number';
import type { EmailMessage } from './provider';
import { PALETTE, emailShell, emailButton, escapeHtml } from './layout';
import { t } from '../i18n/index.ts';

/**
 * Build the guest-link reissue email. Sent when support rotates an order's
 * access token (a reported forwarded/leaked link): the previous links stop
 * working the moment the rotation lands, so this message is the only path the
 * replacement credential is allowed to travel — admin output never shows it.
 * `guestOrderUrl` is the tokenized /order/<token> link, an allowlisted
 * customer-email token position. `order.email` must be set.
 */
export function guestLinkReissueEmail(
  order: Order,
  storeName: string,
  guestOrderUrl: string,
): EmailMessage {
  const num = orderReference(order.public_id, order.id, getConfig().orderNumber);

  const text = [
    t('email.reissue.text', { boutique: storeName, numero: num }),
    ``,
    t('email.reissue.previousDeadLine'),
    guestOrderUrl,
    ``,
    t('email.reissue.ignore1'),
    t('email.reissue.ignore2'),
  ].join('\n');

  const html = emailShell({
    storeName,
    heading: t('email.reissue.heading'),
    subheading: escapeHtml(t('email.reissue.subheading', { numero: num })),
    body:
      `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${PALETTE.muted};">` +
      `${escapeHtml(t('email.reissue.previousDead'))}</p>` +
      emailButton(guestOrderUrl, t('email.order.viewOrder')),
    footer: t('email.reissue.footer'),
  });

  return {
    to: order.email!,
    subject: t('email.reissue.subject', { boutique: storeName, numero: num }),
    html,
    text,
  };
}
