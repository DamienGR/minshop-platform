import { describe, expect, it } from 'vitest';
import {
  BANK_TRANSFER_DEFAULT_DAYS,
  bankTransferDetails,
  formatIban,
  isValidBic,
  isValidIban,
  normalizeIban,
  parseHoldDays,
  transferReference,
} from './bankTransfer';

// The ISO 13616 examples: a French, a German and a British account.
const FR = 'FR7630006000011234567890189';
const DE = 'DE89370400440532013000';
const GB = 'GB82WEST12345698765432';

const settings = (over: Partial<Parameters<typeof bankTransferDetails>[0]> = {}) => ({
  bankTransferIban: FR,
  bankTransferBic: 'AGRIFRPP',
  bankTransferHolder: 'Atelier Test',
  bankTransferDays: BANK_TRANSFER_DEFAULT_DAYS,
  ...over,
});

describe('bank transfer', () => {
  it('accepts an IBAN whatever its spacing and case', () => {
    expect(isValidIban(FR)).toBe(true);
    expect(isValidIban(DE)).toBe(true);
    expect(isValidIban(GB)).toBe(true);
    expect(isValidIban('fr76 3000 6000 0112 3456 7890 189')).toBe(true);
    expect(normalizeIban('fr76 3000 6000-0112')).toBe('FR76300060000112');
  });

  it('refuses an IBAN with one digit wrong, two swapped, or the wrong shape', () => {
    // A typo sends every buyer's money to a bank that returns it, days later.
    expect(isValidIban('FR7630006000011234567890188')).toBe(false);
    expect(isValidIban('FR7630006000011234567809189')).toBe(false);
    expect(isValidIban('FR76')).toBe(false);
    expect(isValidIban('7630006000011234567890189')).toBe(false);
    expect(isValidIban('')).toBe(false);
  });

  it('prints an IBAN in groups of four', () => {
    expect(formatIban(FR)).toBe('FR76 3000 6000 0112 3456 7890 189');
    expect(formatIban('de89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00');
  });

  it('accepts a BIC of eight or eleven characters', () => {
    expect(isValidBic('AGRIFRPP')).toBe(true);
    expect(isValidBic('agrifrpp882')).toBe(true);
    expect(isValidBic('AGRIFRP')).toBe(false);
    expect(isValidBic('AGRI FR PP 88')).toBe(false);
  });

  it('opens the rail only with a holder and an IBAN that passes its check', () => {
    expect(bankTransferDetails(settings())).toEqual({ holder: 'Atelier Test', iban: FR, bic: 'AGRIFRPP' });
    expect(bankTransferDetails(settings({ bankTransferBic: null }))?.bic).toBeNull();
    expect(bankTransferDetails(settings({ bankTransferHolder: '  ' }))).toBeNull();
    expect(bankTransferDetails(settings({ bankTransferIban: 'FR7630006000011234567890188' }))).toBeNull();
    expect(bankTransferDetails(settings({ bankTransferIban: null }))).toBeNull();
  });

  it('holds the stock eight days unless told otherwise, and never out of range', () => {
    expect(parseHoldDays(null)).toBe(8);
    expect(parseHoldDays('15')).toBe(15);
    expect(parseHoldDays('0')).toBe(8);
    expect(parseHoldDays('31')).toBe(8);
    expect(parseHoldDays('2.5')).toBe(8);
  });

  it('names the transfer by the order reference, in capitals', () => {
    expect(transferReference('ord_7k3f9qmz2a')).toBe('7K3F9QMZ2A');
  });
});
