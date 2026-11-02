import { describe, expect, it } from 'vitest';
import type { StoreSettings } from '../settings/db';
import { contactRecipient, contactSettings } from './policy';
import { defaultContactReasons } from './form';

const settings = (overrides: Partial<StoreSettings> = {}): StoreSettings =>
  ({
    configuredSecrets: ['resend_api_key'],
    emailEnabled: true,
    emailProvider: 'resend',
    emailNotifyTo: null,
    contactPageId: 7,
    contactTo: 'atelier@exemple.fr',
    contactReasons: null,
    ...overrides,
  }) as StoreSettings;

const caps = { vault: true, emailBinding: false };

describe('contactSettings', () => {
  it('places the form under the chosen page, with its recipient and the default reasons', () => {
    expect(contactSettings(settings(), '', caps)).toEqual({
      pageId: 7,
      to: 'atelier@exemple.fr',
      reasons: defaultContactReasons(),
    });
  });

  it('offers the merchant’s reasons when there are some', () => {
    expect(contactSettings(settings({ contactReasons: ['Sur mesure'] }), '', caps)?.reasons).toEqual(['Sur mesure']);
  });

  it('shows no form without a page', () => {
    expect(contactSettings(settings({ contactPageId: null }), '', caps)).toBeNull();
    expect(contactSettings(undefined, '', caps)).toBeNull();
  });

  it('shows no form that nobody would receive', () => {
    // E-mail off, or on with nothing to send it.
    expect(contactSettings(settings({ emailEnabled: false }), '', caps)).toBeNull();
    expect(contactSettings(settings(), '', { vault: false, emailBinding: false })).toBeNull();
    expect(contactSettings(settings({ configuredSecrets: [] }), '', caps)).toBeNull();
    expect(contactSettings(settings({ emailProvider: 'cloudflare' }), '', caps)).toBeNull();
    expect(contactSettings(settings({ emailProvider: 'cloudflare' }), '', { vault: false, emailBinding: true })).not.toBeNull();
    // No recipient anywhere.
    expect(contactSettings(settings({ contactTo: null }), '', caps)).toBeNull();
  });
});

describe('contactRecipient', () => {
  it('prefers the form’s own, then the order alerts’, then the build’s', () => {
    expect(contactRecipient({ contactTo: 'a@exemple.fr', emailNotifyTo: 'b@exemple.fr' }, 'c@exemple.fr')).toBe('a@exemple.fr');
    expect(contactRecipient({ contactTo: null, emailNotifyTo: 'b@exemple.fr' }, 'c@exemple.fr')).toBe('b@exemple.fr');
    expect(contactRecipient({ contactTo: null, emailNotifyTo: null }, 'c@exemple.fr')).toBe('c@exemple.fr');
    expect(contactRecipient({ contactTo: null, emailNotifyTo: null }, '')).toBe('');
  });

  it('treats an address it could not write into a header as none', () => {
    expect(contactRecipient({ contactTo: 'pas une adresse', emailNotifyTo: null }, '')).toBe('');
  });
});
