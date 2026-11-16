import { markdownHasImage, renderMarkdown } from '../pages/markdown.ts';

/**
 * A shipping rate's instructions for the buyer (ticket #237): where and when
 * to collect a pickup, how a parcel is handed over. The merchant writes them
 * in Admin → Livraison, in the Markdown of a theme text; the buyer reads them
 * under the rate at /checkout, then on the order's page and in its e-mails,
 * from the copy the order took when it was paid.
 */

/**
 * The longest instructions a rate takes, in characters. Stripe holds a
 * metadata value to 500, and the instructions ride the chosen rate's metadata
 * from its page to the order, so a longer text would not reach a card order.
 */
export const SHIPPING_INSTRUCTIONS_MAX = 500;

/** As stored: line endings folded to `\n` (a textarea posts `\r\n`), the
 *  outer blank lines dropped. Measured after this, so a Windows line ending
 *  does not count twice against the limit. */
export function normalizeShippingInstructions(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').trim();
}

/**
 * What stops a text from being a rate's instructions, or null. No image: one
 * from the library would be a use the media screen must know of before it
 * deletes the file (invariant 10), and one from elsewhere would be fetched by
 * every buyer's mail client.
 */
export function shippingInstructionsProblem(text: string): 'length' | 'image' | null {
  if (text.length > SHIPPING_INSTRUCTIONS_MAX) return 'length';
  if (markdownHasImage(text)) return 'image';
  return null;
}

/**
 * The instructions as a page's HTML: the renderer of the pages, as for a theme
 * text in Markdown. Raw HTML stays text (invariant 11), and with neither
 * `blocks` nor `placeMaps` passed, a `::: encadré` or a ```carte stays text too.
 */
export function shippingInstructionsHtml(text: string): string {
  return renderMarkdown(text);
}
