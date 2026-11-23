import { describe, expect, it } from 'vitest';
import {
  normalizeUmamiScriptUrl,
  normalizeUmamiWebsiteId,
  parseUmamiForm,
  parseUmamiSettings,
  umamiTag,
} from './umami';
import { parseStoreSettings } from '../settings/db';

const ID = '94db1cb1-74f4-4a40-ad6c-962362670409';
const SCRIPT = 'https://cloud.umami.is/script.js';
const settings = { scriptUrl: SCRIPT, websiteId: ID };
const page = (overrides: Partial<Parameters<typeof umamiTag>[1]> = {}) => ({
  pathname: '/products/bol',
  referrerPolicy: null,
  canonicalHost: 'boutique.exemple.fr',
  ...overrides,
});

describe('normalizeUmamiScriptUrl', () => {
  it('keeps an https address, Umami Cloud or a server of its own', () => {
    expect(normalizeUmamiScriptUrl(SCRIPT)).toBe(SCRIPT);
    expect(normalizeUmamiScriptUrl('  https://stats.agence.fr/umami.js ')).toBe('https://stats.agence.fr/umami.js');
  });

  it('refuses what is not an https script address', () => {
    for (const value of [
      '',
      'cloud.umami.is/script.js',
      'http://cloud.umami.is/script.js',
      'javascript:alert(1)',
      'data:text/javascript,alert(1)',
      '//cloud.umami.is/script.js',
      'https://user:pass@cloud.umami.is/script.js',
      'https://cloud.umami.is/script.js#x',
      `https://cloud.umami.is/${'a'.repeat(300)}.js`,
    ]) {
      expect(normalizeUmamiScriptUrl(value), value).toBeNull();
    }
  });
});

describe('normalizeUmamiWebsiteId', () => {
  it('keeps a UUID, lower-cased', () => {
    expect(normalizeUmamiWebsiteId(` ${ID.toUpperCase()} `)).toBe(ID);
  });

  it('refuses anything else', () => {
    for (const value of ['', 'abc', `${ID}x`, ID.replaceAll('-', ''), `"${ID}"`]) {
      expect(normalizeUmamiWebsiteId(value), value).toBeNull();
    }
  });
});

describe('parseUmamiSettings', () => {
  it('reads both stored values, or nothing', () => {
    expect(parseUmamiSettings(SCRIPT, ID)).toEqual(settings);
    expect(parseUmamiSettings(SCRIPT, null)).toBeNull();
    expect(parseUmamiSettings(null, ID)).toBeNull();
    expect(parseUmamiSettings('http://cloud.umami.is/script.js', ID)).toBeNull();
  });

  it('is what the settings read carries', () => {
    expect(parseStoreSettings([]).umami).toBeNull();
    expect(
      parseStoreSettings([
        { key: 'umami_script_url', value: SCRIPT },
        { key: 'umami_website_id', value: ID },
      ]).umami,
    ).toEqual(settings);
    // Half a configuration, written by hand: no script at all.
    expect(parseStoreSettings([{ key: 'umami_script_url', value: SCRIPT }]).umami).toBeNull();
  });
});

describe('parseUmamiForm', () => {
  it('takes the two fields', () => {
    expect(parseUmamiForm(SCRIPT, ID)).toEqual({ ok: true, value: settings });
  });

  it('switches the measurement off when both are empty', () => {
    expect(parseUmamiForm('  ', '')).toEqual({ ok: true, value: null });
  });

  it('reads the tracking code pasted whole into the first field', () => {
    const code = `<script defer src="${SCRIPT}" data-website-id="${ID}"></script>`;
    expect(parseUmamiForm(code, '')).toEqual({ ok: true, value: settings });
    expect(parseUmamiForm(`<script async src='${SCRIPT}' data-website-id='${ID}'></script>`, '')).toEqual({
      ok: true,
      value: settings,
    });
  });

  it('keeps an identifier typed beside a pasted code', () => {
    const other = '00000000-0000-4000-8000-000000000000';
    const code = `<script defer src="${SCRIPT}" data-website-id="${ID}"></script>`;
    expect(parseUmamiForm(code, other)).toEqual({ ok: true, value: { scriptUrl: SCRIPT, websiteId: other } });
  });

  it('refuses half a configuration', () => {
    expect(parseUmamiForm(SCRIPT, '')).toEqual({ ok: false, error: 'admin.settings.audience.error.incomplete' });
    expect(parseUmamiForm('', ID)).toEqual({ ok: false, error: 'admin.settings.audience.error.incomplete' });
  });

  it('says which value is wrong', () => {
    expect(parseUmamiForm('http://cloud.umami.is/script.js', ID)).toEqual({
      ok: false,
      error: 'admin.settings.audience.error.scriptUrl',
    });
    expect(parseUmamiForm(SCRIPT, 'site-de-la-boutique')).toEqual({
      ok: false,
      error: 'admin.settings.audience.error.websiteId',
    });
    // A pasted tag with no src: the address is missing, not malformed.
    expect(parseUmamiForm(`<script data-website-id="${ID}"></script>`, '')).toEqual({
      ok: false,
      error: 'admin.settings.audience.error.incomplete',
    });
  });
});

describe('umamiTag', () => {
  it('draws nothing while the shop does not measure', () => {
    expect(umamiTag(null, page())).toBeNull();
    expect(umamiTag(undefined, page())).toBeNull();
  });

  it('draws the tracker on a storefront page, for the public host only', () => {
    expect(umamiTag(settings, page())).toEqual({ ...settings, domain: 'boutique.exemple.fr' });
    expect(umamiTag(settings, page({ canonicalHost: null }))).toEqual({ ...settings, domain: null });
  });

  it('never measures the admin, which the storefront layout also draws', () => {
    for (const pathname of ['/admin', '/admin/login', '/admin/token', '/admin/pages/3/preview']) {
      expect(umamiTag(settings, page({ pathname })), pathname).toBeNull();
    }
    expect(umamiTag(settings, page({ pathname: '/administration-des-ventes' }))).not.toBeNull();
  });

  it('never sends the URL of a page that keeps it from other sites', () => {
    // /order/<token> and /pay/<id> set it: their URL opens the order.
    expect(umamiTag(settings, page({ pathname: '/order/abc', referrerPolicy: 'no-referrer' }))).toBeNull();
    expect(umamiTag(settings, page({ referrerPolicy: ' No-Referrer ' }))).toBeNull();
    expect(umamiTag(settings, page({ referrerPolicy: 'strict-origin-when-cross-origin' }))).not.toBeNull();
  });
});
