import { formatPrice } from '../../config';
import type { PendingPayment } from '../payments/lightning/pending';
import { formatIban, transferReference, type BankTransferDetails } from '../payments/bankTransfer.ts';
import { t } from '../i18n/index.ts';
import type { EmailMessage } from './provider';
import { PALETTE, emailButton, emailItemsTable, emailLabel, emailShell, escapeHtml } from './layout';

/**
 * The two e-mails a bank transfer sends while it is awaited (ADR 0023): the
 * buyer's copy of the transfer page, and the merchant's word that a transfer
 * is coming. Neither is an order notification — there is no order yet, so the
 * outbox (keyed on an order) does not carry them; they are sent once, at the
 * checkout, and the page stays the reference.
 *
 * Pure: the caller formats the deadline in the shop's time zone.
 */

/** What both e-mails and the page say about one awaited transfer. */
export interface TransferSummary {
  reference: string;
  email: string | null;
  amountCents: number;
  shippingCents: number;
  currency: string;
  lines: Array<{ name: string; quantity: number; priceCents: number }>;
  /** The deadline, already formatted for a reader. */
  due: string;
}

/** The pending row as the buyer's summary; a broken item snapshot shows no line. */
export function transferSummary(pending: PendingPayment, due: string): TransferSummary {
  let lines: TransferSummary['lines'] = [];
  try {
    const raw = pending.items ? (JSON.parse(pending.items) as Array<{ q: number; n: string; p: number }>) : [];
    lines = raw.map((r) => ({ name: r.n, quantity: r.q, priceCents: r.p }));
  } catch {
    lines = [];
  }
  return {
    reference: transferReference(pending.public_id),
    email: pending.email,
    amountCents: pending.amount_total_cents,
    shippingCents: pending.shipping_cents,
    currency: pending.currency,
    lines,
    due,
  };
}

/** The account to pay into, one « label : value » per line. */
export function transferDetailLines(details: BankTransferDetails, summary: TransferSummary): Array<[string, string]> {
  return [
    [t('transfer.holder'), details.holder],
    [t('transfer.iban'), formatIban(details.iban)],
    ...(details.bic ? [[t('transfer.bic'), details.bic] as [string, string]] : []),
    [t('transfer.amount'), formatPrice(summary.amountCents, summary.currency)],
    [t('transfer.reference'), summary.reference],
  ];
}

function itemsBlock(summary: TransferSummary): { text: string[]; html: string } {
  const money = (cents: number) => formatPrice(cents, summary.currency);
  const totals = [
    ...(summary.shippingCents > 0 ? [{ label: t('email.total.shipping'), amount: money(summary.shippingCents) }] : []),
    { label: t('email.total.total'), amount: money(summary.amountCents), strong: true },
  ];
  return {
    text: [
      ...summary.lines.map((line) => `${line.name} × ${line.quantity}: ${money(line.priceCents * line.quantity)}`),
      ...totals.map(({ label, amount }) => t('transfer.line', { libelle: label, valeur: amount })),
    ],
    html: emailItemsTable(
      summary.lines.map((line) => ({
        thumb: '',
        name: line.name,
        quantity: line.quantity,
        amount: money(line.priceCents * line.quantity),
      })),
      totals,
    ),
  };
}

/**
 * The buyer's copy: the account, the amount, the reference, the deadline.
 * `payUrl` is the tokenized transfer page (an allowlisted e-mail position).
 */
export function bankTransferInstructionsEmail(
  summary: TransferSummary,
  details: BankTransferDetails,
  storeName: string,
  payUrl: string | null,
): EmailMessage {
  const montant = formatPrice(summary.amountCents, summary.currency);
  const rows = transferDetailLines(details, summary);
  const items = itemsBlock(summary);
  const text = [
    t('email.transfer.heading'),
    ``,
    t('email.transfer.subheading', { montant, date: summary.due }),
    t('email.transfer.intro', { date: summary.due }),
    ``,
    t('email.transfer.detailsLine'),
    ...rows.map(([libelle, valeur]) => t('transfer.line', { libelle, valeur })),
    ``,
    t('transfer.referenceHint', { reference: summary.reference }),
    t('transfer.expiry', { date: summary.due }),
    ``,
    ...items.text,
    ...(payUrl ? [``, t('email.transfer.viewPageLine', { url: payUrl })] : []),
  ].join('\n');

  const detailsHtml =
    emailLabel(t('email.transfer.details')) +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;">${rows
      .map(
        ([label, value]) =>
          `<tr><td style="padding:2px 12px 2px 0;color:${PALETTE.muted};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:2px 0;font-family:monospace;font-size:15px;color:${PALETTE.brand};">${escapeHtml(value)}</td></tr>`,
      )
      .join('')}</table>`;

  const html = emailShell({
    storeName,
    heading: t('email.transfer.heading'),
    subheading: escapeHtml(t('email.transfer.subheading', { montant, date: summary.due })),
    body:
      `<p style="margin:20px 0 0;font-size:14px;line-height:1.6;">${escapeHtml(t('email.transfer.intro', { date: summary.due }))}</p>` +
      detailsHtml +
      `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;">${escapeHtml(t('transfer.referenceHint', { reference: summary.reference }))}</p>` +
      `<p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:${PALETTE.muted};">${escapeHtml(t('transfer.expiry', { date: summary.due }))}</p>` +
      items.html +
      (payUrl ? emailButton(payUrl, t('email.transfer.viewPage')) : ''),
    footer: escapeHtml(t('email.order.footer')),
  });

  return {
    to: summary.email!,
    subject: t('email.transfer.subject', { boutique: storeName, numero: summary.reference }),
    html,
    text,
  };
}

/**
 * The merchant's notice: a transfer is coming, for this amount and this
 * reference, and the stock is held until the deadline. The reconciliation is
 * theirs, so they are told what to look for on the statement.
 */
export function bankTransferAwaitedEmail(
  summary: TransferSummary,
  to: string,
  storeName: string,
  adminUrl: string,
): EmailMessage {
  const montant = formatPrice(summary.amountCents, summary.currency);
  const items = itemsBlock(summary);
  const customer = t('email.transferAwaited.customer', { email: summary.email ?? t('email.notification.unknownEmail') });
  const lead = t('email.transferAwaited.subheading', { montant, reference: summary.reference, date: summary.due });
  const text = [
    t('email.transferAwaited.heading'),
    ``,
    lead,
    customer,
    ``,
    t('email.transferAwaited.body', { date: summary.due }),
    ``,
    ...items.text,
    ``,
    t('email.transferAwaited.buttonLine', { url: adminUrl }),
  ].join('\n');
  const html = emailShell({
    storeName,
    heading: t('email.transferAwaited.heading'),
    subheading: escapeHtml(lead),
    body:
      `<p style="margin:20px 0 0;font-size:14px;line-height:1.6;">${escapeHtml(customer)}</p>` +
      `<p style="margin:12px 0 0;font-size:14px;line-height:1.6;">${escapeHtml(t('email.transferAwaited.body', { date: summary.due }))}</p>` +
      items.html +
      emailButton(adminUrl, t('email.transferAwaited.button')),
  });
  return {
    to,
    subject: t('email.transferAwaited.subject', { boutique: storeName, numero: summary.reference }),
    html,
    text,
  };
}
