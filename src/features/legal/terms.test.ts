import { describe, expect, it } from 'vitest';
import { consentFor, isAcceptance, termsHref, type TermsGate } from './terms';

const gate: TermsGate = { required: true, href: '/pages/cgv', version: '2' };

describe('terms acceptance', () => {
  it('reads what a checked box submits', () => {
    // An HTML checkbox sends its `value` — "on" by default — and an unchecked
    // one sends nothing at all.
    expect(isAcceptance('on')).toBe(true);
    expect(isAcceptance(undefined)).toBe(false);
    expect(isAcceptance(null)).toBe(false);
  });

  it('reads the JSON shapes a client sends', () => {
    expect(isAcceptance(true)).toBe(true);
    expect(isAcceptance('true')).toBe(true);
    expect(isAcceptance('1')).toBe(true);
  });

  it('refuses "false", which Boolean() would read as consent', () => {
    expect(isAcceptance('false')).toBe(false);
    expect(isAcceptance('0')).toBe(false);
    expect(isAcceptance('non')).toBe(false);
    expect(isAcceptance(0)).toBe(false);
  });
});

describe('the consent record', () => {
  it('captures the version in force at acceptance', () => {
    const consent = consentFor(gate, true);

    expect(consent?.version).toBe('2');
  });

  it('timestamps in the shape SQLite writes', () => {
    // Stored beside datetime('now') values, which are UTC "YYYY-MM-DD HH:MM:SS"
    // with no zone marker. An ISO string with a T and a Z would read back as a
    // different instant through formatDate().
    expect(consentFor(gate, true)?.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('records nothing when the box was not ticked', () => {
    expect(consentFor(gate, false)).toBeNull();
  });
});

describe('termsHref', () => {
  it('points at the page route', () => {
    expect(termsHref('conditions-generales-de-vente')).toBe(
      '/pages/conditions-generales-de-vente',
    );
  });
});
