import { describe, expect, it } from 'vitest';
import { beforeSend, campaignQuery, withCampaign } from './beforeSend';

const shopper = { cookies: 'cart_n=2; discount=NOEL', search: '' };

describe('campaignQuery', () => {
  it('keeps the campaign parameters alone, in order', () => {
    expect(campaignQuery('?q=bol&utm_source=lettre&page=2&utm_campaign=noel%202026')).toBe(
      'utm_source=lettre&utm_campaign=noel+2026',
    );
  });

  it('is empty without one', () => {
    expect(campaignQuery('')).toBe('');
    expect(campaignQuery('?q=bol&sort=price&token=abc')).toBe('');
    expect(campaignQuery('?UTM_SOURCE=x&utm_=y&utm_source2=z')).toBe('');
  });
});

describe('withCampaign', () => {
  it('adds them to the URL Umami reports, absolute or not', () => {
    expect(withCampaign('/products/bol', '?utm_source=insta')).toBe('/products/bol?utm_source=insta');
    expect(withCampaign('https://boutique.exemple.fr/', '?utm_medium=email')).toBe(
      'https://boutique.exemple.fr/?utm_medium=email',
    );
    // A server that ignored data-exclude-search: appended, never doubled.
    expect(withCampaign('/search?q=bol', '?utm_source=insta')).toBe('/search?q=bol&utm_source=insta');
  });

  it('leaves the URL alone without one', () => {
    expect(withCampaign('/search', '?q=bol')).toBe('/search');
  });
});

describe('beforeSend', () => {
  it('sends a shopper’s page view with the campaign put back', () => {
    const payload = { website: 'id', url: '/products/bol', referrer: 'https://www.instagram.com/' };
    expect(beforeSend(payload, { ...shopper, search: '?utm_source=insta&q=x' })).toEqual({
      ...payload,
      url: '/products/bol?utm_source=insta',
    });
  });

  it('sends nothing from a browser that opened the admin', () => {
    expect(beforeSend({ url: '/' }, { cookies: 'cart_n=0; admin_hint=1', search: '' })).toBe(false);
  });

  it('passes a payload without a URL as it came', () => {
    const payload = { website: 'id', name: 'event' };
    expect(beforeSend(payload, shopper)).toBe(payload);
    expect(beforeSend(undefined, shopper)).toBeUndefined();
  });
});
