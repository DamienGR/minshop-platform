import type { D1Database } from '@cloudflare/workers-types';
import { getSecret } from '../../secrets/store';
import type { LabelProvider, PickupPointProvider, ShippingQuoteProvider } from '../provider.ts';
import { boxtalQuote } from './quote.ts';
import { boxtalLabels, boxtalPickupPoints } from './v3.ts';

export interface BoxtalProviders {
  points: PickupPointProvider;
  labels: LabelProvider;
  /** Null without the v1 application's keys: labels are then bought unpriced. */
  quote: ShippingQuoteProvider | null;
}

/**
 * Boxtal's adapters from the vault (ADR 0020, 0021). Two key pairs, never the
 * account's login: the v3 application's, required, and the v1 application's,
 * optional, for the quote alone. Null when the v3 pair is incomplete.
 *
 * `sandbox` is the caller's to give: Boxtal's sandbox keys only open its
 * sandbox, and live keys only production, so the two must agree.
 */
export async function getBoxtal(db: D1Database, sandbox: boolean): Promise<BoxtalProviders | null> {
  const [accessKey, secretKey, quoteAccessKey, quoteSecretKey] = await Promise.all([
    getSecret(db, 'boxtal_access_key'),
    getSecret(db, 'boxtal_secret_key'),
    getSecret(db, 'boxtal_quote_access_key'),
    getSecret(db, 'boxtal_quote_secret_key'),
  ]);
  if (!accessKey || !secretKey) return null;
  const options = { keys: { accessKey, secretKey }, sandbox };
  return {
    points: boxtalPickupPoints(options),
    labels: boxtalLabels(options),
    quote:
      quoteAccessKey && quoteSecretKey
        ? boxtalQuote({ keys: { accessKey: quoteAccessKey, secretKey: quoteSecretKey }, sandbox })
        : null,
  };
}
