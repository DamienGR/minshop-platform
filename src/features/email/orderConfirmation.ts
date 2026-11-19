import { formatPrice, getConfig } from '../../config';
import type { Order, OrderItemWithImage, ShippingAddress } from '../orders/db';
import { orderReference } from '../orders/number';
import {
  productEmailImageUrl,
  type ImageDelivery,
} from '../products/image';
import { orderTrackingUrl, shippedCarrierName } from '../orders/tracking';
import { orderRelayPoint, relayPointLines } from '../shipping/relay.ts';
import { t, formatNumber } from '../i18n/index.ts';
import { discountLabel } from '../discounts/code.ts';
import { customizationText, parseCustomization } from '../products/customization.ts';
import { orderVatExemption } from '../legal/vat.ts';
import type { EmailMessage } from './provider';
import { emailMarkdownHtml } from './markdown.ts';
import {
  PALETTE,
  emailShell,
  emailButton,
  emailLabel,
  emailItemsTable,
  escapeHtml,
  type TotalRow,
} from './layout';

/** A 48px product thumbnail cell (absolute URL so email clients can fetch it).
 *  `new URL` resolves both an absolute image base (R2 domain) and the relative
 *  /images route against the site origin. */
const thumbCell = (
  imageKey: string | null,
  baseUrl: string,
  imageDelivery: ImageDelivery,
): string => {
  const src = productEmailImageUrl(
    imageKey,
    baseUrl,
    getConfig().images.baseUrl,
    imageDelivery,
  );
  return `<td style="width:60px;padding:10px 0;border-bottom:1px solid ${PALETTE.line};"><img src="${escapeHtml(src)}" width="48" height="48" alt="" style="display:block;border-radius:4px;object-fit:cover;background:${PALETTE.paper};" /></td>`;
};

/** Shipping / discount / tax / total, in the order they appear on a receipt. */
function totalRows(order: Order, money: (cents: number) => string): TotalRow[] {
  return [
    ...(order.shipping_cents > 0
      ? [{ label: t('email.total.shipping'), amount: money(order.shipping_cents) }]
      : []),
    ...(order.discount_cents > 0
      ? [{ label: discountLabel(order.discount_code), amount: `&minus;${money(order.discount_cents)}` }]
      : []),
    ...(order.tax_cents > 0
      ? [{ label: t('email.total.tax'), amount: money(order.tax_cents) }]
      : []),
    { label: t('email.total.total'), amount: money(order.amount_total_cents), strong: true },
    // Prices are TTC, so this is a BREAKDOWN of the line above, never an
    // addition to it — hence its place under the total rather than beside the
    // shipping and discount rows.
    ...(order.vat_amount_cents != null && order.vat_rate_bps
      ? [
          {
            label: t('email.total.vatIncluded', { taux: formatNumber(order.vat_rate_bps / 100) }),
            amount: money(order.vat_amount_cents),
          },
        ]
      : []),
  ];
}

/**
 * The legal mention of an order sold without VAT (ADR 0024): « TVA non
 * applicable, art. 293 B du CGI » under the totals, where a liable shop's order
 * reads its VAT breakdown. A sentence, not a row: it has no amount. Read off
 * the order, which recorded it at checkout, never off today's configuration.
 */
function vatExemptionNote(order: Order): string | null {
  const exemption = orderVatExemption(order);
  return exemption ? t(`vat.exemption.${exemption}`) : null;
}

/**
 * The same rows for the plain-text part. A client that shows the text part, or a
 * reader that reads it aloud, gets the whole receipt: the VAT breakdown was once
 * in the HTML only. So does the exemption's mention.
 */
function totalLines(order: Order, money: (cents: number) => string): string[] {
  const note = vatExemptionNote(order);
  return [
    ...totalRows(order, money).map(({ label, amount }) => `${label} : ${amount.replace('&minus;', '-')}`),
    ...(note ? [note] : []),
  ];
}

/** The mention under the HTML totals table, or nothing. */
function vatExemptionHtml(order: Order): string {
  const note = vatExemptionNote(order);
  return note
    ? `<p style="margin:8px 0 0;font-size:13px;text-align:right;color:${PALETTE.muted};">${escapeHtml(note)}</p>`
    : '';
}

/** One-line-per-field shipping address, blank lines dropped. */
function formatShipAddress(order: Order): string {
  if (!order.ship_address) return '-';
  const a = JSON.parse(order.ship_address) as ShippingAddress;
  return [
    a.name,
    a.line1,
    a.line2,
    [a.city, a.state, a.postal].filter(Boolean).join(', '),
    a.country,
  ]
    .filter(Boolean)
    .join('\n');
}

/** What the buyer typed on a line, one « label : text » per field (ticket #125). */
const customizationLines = (item: OrderItemWithImage): string[] =>
  parseCustomization(item.customization).map(customizationText);

/**
 * The relay point a relay order is collected at, under its heading: the
 * shopper reads where to go, the merchant also reads the code the label needs.
 */
function relayBlock(order: Order, heading: string, withCode = false): { text: string[]; html: string } {
  const point = orderRelayPoint(order);
  if (!point) return { text: [], html: '' };
  const lines = [...relayPointLines(point), ...(withCode ? [t('email.relay.code', { code: point.code })] : [])];
  return {
    text: [``, `${heading} :`, ...lines],
    html:
      emailLabel(heading) +
      `<p style="margin:0;font-size:14px;line-height:1.6;">${lines.map((line) => escapeHtml(line)).join('<br>')}</p>`,
  };
}

/**
 * The rate the order was paid with and its instructions for the buyer (ticket
 * #237), under « Livraison », from the copy the order took when it was paid.
 * Nothing for an order whose rate said none: its e-mails stay as they were.
 * The HTML part renders the merchant's Markdown for a mailbox (absolute links,
 * inline styles); the text part keeps it as they wrote it.
 */
function deliveryBlock(order: Order, heading: string, origin: string): { text: string[]; html: string } {
  const instructions = order.shipping_instructions;
  if (!instructions) return { text: [], html: '' };
  const label = order.shipping_label;
  return {
    text: [``, `${heading} :`, ...(label ? [label] : []), ...instructions.split('\n')],
    html:
      emailLabel(heading) +
      (label ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;font-weight:600;">${escapeHtml(label)}</p>` : '') +
      emailMarkdownHtml(instructions, origin),
  };
}

/**
 * The comment the buyer left on the order (ADR 0028), under its heading, its
 * line breaks kept. Their text: escaped in the HTML part like everything else,
 * and never turned into a link.
 */
function commentBlock(order: Order, heading: string): { text: string[]; html: string } {
  if (!order.buyer_comment) return { text: [], html: '' };
  return {
    text: [``, `${heading} :`, ...order.buyer_comment.split('\n')],
    html:
      emailLabel(heading) +
      `<p style="margin:0;font-size:14px;line-height:1.6;">${escapeHtml(order.buyer_comment).replace(/\n/g, '<br>')}</p>`,
  };
}

/**
 * Build the order-confirmation email for a paid order. `order.email` must be set.
 * `baseUrl` is the site origin (e.g. https://shop.example.com) for the order link.
 */
export function orderConfirmationEmail(
  order: Order,
  items: OrderItemWithImage[],
  baseUrl: string,
  storeName: string,
  imageDelivery: ImageDelivery = 'original',
  /** Tokenized guest link (allowlisted email position); null = omit the link. */
  guestOrderUrl?: string | null,
): EmailMessage {
  const cfg = getConfig();
  const num = orderReference(order.public_id, order.id, cfg.orderNumber);
  const money = (cents: number) => formatPrice(cents, order.currency);
  const orderUrl = guestOrderUrl ?? null;
  const hasDigital = items.some((item) => Boolean(item.file_key));
  const delivery = deliveryBlock(order, t('email.delivery.heading'), baseUrl);
  const relay = relayBlock(order, t('email.relay.heading'));
  const comment = commentBlock(order, t('email.order.comment'));

  const rows = items.flatMap((it) => [
    `${it.name} × ${it.quantity}: ${money(it.price_cents * it.quantity)}`,
    ...customizationLines(it).map((line) => `  ${line}`),
  ]);

  const text = [
    t('email.order.thanks'),
    ``,
    t('email.order.reference', { numero: num, boutique: storeName }),
    ``,
    ...rows,
    ...totalLines(order, money),
    ...delivery.text,
    ...relay.text,
    ...comment.text,
    ...(hasDigital && orderUrl ? [``, t('email.order.download')] : []),
    ...(orderUrl ? [``, t('email.order.viewOrderLine', { url: orderUrl })] : []),
  ].join('\n');

  const html = emailShell({
    storeName,
    heading: t('email.order.heading'),
    // A pickup is never shipped (ticket #238): the next e-mail says it is ready.
    subheading:
      order.delivery_method === 'pickup'
        ? t('email.order.subheadingPickup', { numero: num })
        : t('email.order.subheading', { numero: num }),
    body:
      emailItemsTable(
        items.map((it) => ({
          thumb: thumbCell(it.image_key, baseUrl, imageDelivery),
          name: it.name,
          quantity: it.quantity,
          amount: money(it.price_cents * it.quantity),
          details: customizationLines(it),
        })),
        totalRows(order, money),
      ) +
      vatExemptionHtml(order) +
      delivery.html +
      relay.html +
      comment.html +
      (hasDigital && orderUrl
        ? `<p style="margin:20px 0 0;font-size:14px;">${escapeHtml(t('email.order.download'))}</p>`
        : '') +
      (orderUrl ? emailButton(orderUrl, t('email.order.viewOrder')) : ''),
    footer: t('email.order.footer'),
  });

  return {
    to: order.email!,
    subject: t('email.order.subject', { boutique: storeName, numero: num }),
    html,
    text,
  };
}

/**
 * Build the store-owner "new order" notification. `to` is the owner address;
 * `baseUrl` is the site origin for the admin order link.
 */
export function orderNotificationEmail(
  order: Order,
  items: OrderItemWithImage[],
  to: string,
  baseUrl: string,
  storeName: string,
  imageDelivery: ImageDelivery = 'original',
): EmailMessage {
  const publicId = order.public_id ?? '—';
  // The number the customer was given, the admin titles the order with and the
  // CSV export carries — never the row id, which read "n°1" beside a customer's
  // "n°2vgje1r0cb" (certification, étape 10). The public id stays in the body,
  // where the admin link uses it, and leaves the subject, where it repeated the
  // number.
  const num = orderReference(order.public_id, order.id, getConfig().orderNumber);
  const money = (cents: number) => formatPrice(cents, order.currency);
  const shipText = formatShipAddress(order);
  // Which rate, so a shop with a pickup per place knows which (ticket #237).
  const rate = order.shipping_label;
  const relay = relayBlock(order, t('email.notification.relayPoint'), true);
  // Read before the lines: it may change how they are made or packed.
  const comment = commentBlock(order, t('email.notification.comment'));
  const adminUrl = `${baseUrl}/admin/orders/${order.public_id ?? order.id}`;

  const rows = items.flatMap((it) => [
    `${it.name} × ${it.quantity}: ${money(it.price_cents * it.quantity)}`,
    ...customizationLines(it).map((line) => `  ${line}`),
  ]);

  const text = [
    t('email.notification.newOrder', { numero: num }),
    t('email.notification.publicId', { id: publicId }),
    ``,
    t('email.notification.customer', { email: order.email ?? '-' }),
    ``,
    `${t('email.notification.shipTo')} :`,
    shipText,
    ...(rate ? [``, `${t('email.notification.rate')} :`, rate] : []),
    ...relay.text,
    ...comment.text,
    ``,
    ...rows,
    ...totalLines(order, money),
    ``,
    t('email.notification.viewInAdminLine', { url: adminUrl }),
  ].join('\n');

  const html = emailShell({
    storeName,
    heading: t('email.notification.heading', { numero: num }),
    subheading: t('email.notification.subheading', {
      montant: money(order.amount_total_cents),
      email: escapeHtml(order.email ?? t('email.notification.unknownEmail')),
    }),
    body:
      emailLabel(t('email.notification.identifiers')) +
      `<p style="margin:0;font-size:14px;line-height:1.6;">${escapeHtml(
        t('email.order.reference', { numero: num, boutique: storeName }),
      )}<br><span style="font-family:monospace;">${escapeHtml(publicId)}</span></p>` +
      emailLabel(t('email.notification.shipTo')) +
      `<p style="margin:0;font-size:14px;line-height:1.6;">${escapeHtml(shipText).replace(/\n/g, '<br>')}</p>` +
      (rate
        ? emailLabel(t('email.notification.rate')) +
          `<p style="margin:0;font-size:14px;line-height:1.6;">${escapeHtml(rate)}</p>`
        : '') +
      relay.html +
      comment.html +
      emailItemsTable(
        items.map((it) => ({
          thumb: thumbCell(it.image_key, baseUrl, imageDelivery),
          name: it.name,
          quantity: it.quantity,
          amount: money(it.price_cents * it.quantity),
          details: customizationLines(it),
        })),
        totalRows(order, money),
      ) +
      vatExemptionHtml(order) +
      emailButton(adminUrl, t('email.notification.viewInAdmin')),
  });

  return {
    to,
    subject: t('email.notification.subject', { boutique: storeName, numero: num }),
    html,
    text,
  };
}

/**
 * Build the "your order has shipped" email. `order.email` must be set. Never
 * for a pickup, which is not shipped: orderPickupReadyEmail is its notice.
 */
export function orderShippedEmail(
  order: Order,
  storeName: string,
  /** Tokenized guest link (allowlisted email position); null = omit the link. */
  guestOrderUrl?: string | null,
  /** The site origin, for the links of the rate's instructions (ticket #237). */
  baseUrl = '',
): EmailMessage {
  const cfg = getConfig();
  const num = orderReference(order.public_id, order.id, cfg.orderNumber);
  const url = orderTrackingUrl(order);
  const carrier = shippedCarrierName(order.tracking_carrier);
  const orderUrl = guestOrderUrl ?? null;
  const delivery = deliveryBlock(order, t('email.delivery.heading'), baseUrl);
  const relay = relayBlock(order, t('email.shipped.relayPoint'));

  const text = [
    t('email.shipped.text', { numero: num }),
    ...(order.tracking_number
      ? [
          ``,
          ...(carrier ? [t('email.shipped.carrier', { transporteur: carrier })] : []),
          t('email.shipped.number', { numero: order.tracking_number }),
          ...(url ? [t('email.shipped.trackLine', { url })] : []),
        ]
      : []),
    ...delivery.text,
    ...relay.text,
    ...(orderUrl ? [``, t('email.order.viewOrderLine', { url: orderUrl })] : []),
  ].join('\n');

  const trackingHtml = order.tracking_number
    ? emailLabel(t('email.shipped.tracking')) +
      `<p style="margin:0;font-size:14px;line-height:1.6;">
        ${carrier ? `${escapeHtml(carrier)}<br>` : ''}
        ${
          url
            ? `<a href="${url}" style="color:${PALETTE.brand};font-weight:600;">${escapeHtml(order.tracking_number)}</a>`
            : escapeHtml(order.tracking_number)
        }
      </p>`
    : '';

  const html = emailShell({
    storeName,
    heading: t('email.shipped.heading'),
    subheading: t('email.shipped.subheading', { numero: num }),
    body:
      trackingHtml +
      delivery.html +
      relay.html +
      (url
        ? emailButton(url, t('email.shipped.trackButton'))
        : orderUrl
          ? emailButton(orderUrl, t('email.order.viewOrder'))
          : ''),
    footer:
      orderUrl && url
        ? `${escapeHtml(t('email.shipped.footer'))}<a href="${orderUrl}" style="color:${PALETTE.muted};">${orderUrl}</a>`
        : undefined,
  });

  return {
    to: order.email!,
    subject: t('email.shipped.subject', { boutique: storeName, numero: num }),
    html,
    text,
  };
}

/**
 * Build the "ready to collect" email of a pickup order (ticket #238), sent
 * where a delivery is told it is on its way. `order.email` must be set. The
 * place is the rate the buyer chose, a shop with several places having a rate
 * for each, and its instructions say where, when and how (ticket #237).
 */
export function orderPickupReadyEmail(
  order: Order,
  storeName: string,
  /** Tokenized guest link (allowlisted email position); null = omit the link. */
  guestOrderUrl: string | null,
  /** The site origin, for the links of the rate's instructions. */
  baseUrl: string,
): EmailMessage {
  const cfg = getConfig();
  const num = orderReference(order.public_id, order.id, cfg.orderNumber);
  const orderUrl = guestOrderUrl ?? null;
  const heading = t('email.pickup.where');
  const label = order.shipping_label;
  const instructions = order.shipping_instructions;
  const place = label || instructions;

  const text = [
    t('email.pickup.text', { numero: num }),
    ...(place
      ? [``, `${heading} :`, ...(label ? [label] : []), ...(instructions ? instructions.split('\n') : [])]
      : []),
    ...(orderUrl ? [``, t('email.order.viewOrderLine', { url: orderUrl })] : []),
  ].join('\n');

  const html = emailShell({
    storeName,
    heading: t('email.pickup.heading'),
    subheading: t('email.pickup.subheading', { numero: num }),
    body:
      (place ? emailLabel(heading) : '') +
      (label
        ? `<p style="margin:0 0 8px;font-size:14px;line-height:1.6;font-weight:600;">${escapeHtml(label)}</p>`
        : '') +
      (instructions ? emailMarkdownHtml(instructions, baseUrl) : '') +
      (orderUrl ? emailButton(orderUrl, t('email.order.viewOrder')) : ''),
  });

  return {
    to: order.email!,
    subject: t('email.pickup.subject', { boutique: storeName, numero: num }),
    html,
    text,
  };
}

/**
 * Refund notice. Sent once per newly recognised refund — the amount the total
 * just advanced by, not the cumulative total — so a partial refund followed by
 * another reads as two distinct amounts rather than one growing number.
 *
 * `refundedCents` is the running total, shown only when it differs from this
 * refund, i.e. when there was an earlier one.
 */
export function orderRefundedEmail(
  order: Order,
  refundCents: number,
  refundedCents: number,
  storeName: string,
  /** Tokenized guest link (allowlisted email position); null = omit the link. */
  guestOrderUrl?: string | null,
): EmailMessage {
  const cfg = getConfig();
  const num = orderReference(order.public_id, order.id, cfg.orderNumber);
  const orderUrl = guestOrderUrl ?? null;
  const full = refundedCents >= order.amount_total_cents;
  const remaining = Math.max(0, order.amount_total_cents - refundedCents);
  const method = order.payment_method;

  // How the money actually gets back differs per rail, and the honest answer is
  // "it depends on your bank" for cards. Saying nothing invites a support email.
  const timing =
    method === 'stripe' || method === null
      ? t('email.refund.timing.card')
      : t('email.refund.timing.other');

  // Prices in the ORDER's currency, not the store's current one — an order
  // placed before a currency change must still read back in what was charged.
  const money = (cents: number) => formatPrice(cents, order.currency);

  const priorLine =
    refundedCents > refundCents
      ? t('email.refund.totalSoFarLine', { montant: money(refundedCents) })
      : null;

  const text = [
    full
      ? t('email.refund.textFull', { numero: num })
      : t('email.refund.textPartial', { numero: num }),
    ``,
    `${t('email.refund.amount')} : ${money(refundCents)}`,
    ...(priorLine ? [priorLine] : []),
    ...(full ? [] : [`${t('email.refund.stillPaid')} : ${money(remaining)}`]),
    ``,
    timing,
    ...(orderUrl ? [``, t('email.order.viewOrderLine', { url: orderUrl })] : []),
  ].join('\n');

  const rows: TotalRow[] = [
    { label: t('email.refund.amount'), amount: money(refundCents), strong: true },
    ...(priorLine
      ? [{ label: t('email.refund.totalSoFar'), amount: money(refundedCents) }]
      : []),
    ...(full ? [] : [{ label: t('email.refund.stillPaid'), amount: money(remaining) }]),
  ];

  const html = emailShell({
    storeName,
    heading: full ? t('email.refund.headingFull') : t('email.refund.headingPartial'),
    subheading: t('email.refund.subheading', { numero: num }),
    body:
      emailLabel(t('email.refund.label')) +
      `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">${rows
        .map(
          (r) =>
            `<tr><td style="padding:4px 0;font-size:14px;color:${PALETTE.muted};">${escapeHtml(r.label)}</td>` +
            `<td align="right" style="padding:4px 0;font-size:14px;${r.strong ? 'font-weight:600;' : ''}">${escapeHtml(r.amount)}</td></tr>`,
        )
        .join('')}</table>` +
      `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${PALETTE.muted};">${escapeHtml(timing)}</p>` +
      (orderUrl ? emailButton(orderUrl, t('email.order.viewOrder')) : ''),
  });

  return {
    to: order.email!,
    subject: full
      ? t('email.refund.subjectFull', { boutique: storeName, numero: num })
      : t('email.refund.subjectPartial', { boutique: storeName, numero: num }),
    html,
    text,
  };
}
