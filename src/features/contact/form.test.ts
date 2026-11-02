import { describe, expect, it } from 'vitest';
import {
  CONTACT_LIMITS,
  CONTACT_TRAP_FIELD,
  contactReasons,
  defaultContactReasons,
  isContactAddress,
  parseReasonsInput,
  readContactForm,
  validateContact,
  type ContactValues,
} from './form';

const REASONS = ['Renseignement', 'Sur mesure', 'Autre'];

const values = (overrides: Partial<ContactValues> = {}): ContactValues => ({
  name: 'Claire Dubois',
  email: 'claire@exemple.fr',
  phone: '',
  reason: 'Sur mesure',
  message: 'Bonjour,\nun sac brodé à mon prénom ?',
  ...overrides,
});

const formData = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
};

describe('readContactForm', () => {
  it('reads every field, an absent one as empty, and normalises line breaks', () => {
    const { values: read, trapped } = readContactForm(
      formData({ name: 'Claire', email: 'c@exemple.fr', message: 'un\r\ndeux\rtrois' }),
    );
    expect(read).toEqual({ name: 'Claire', email: 'c@exemple.fr', phone: '', reason: '', message: 'un\ndeux\ntrois' });
    expect(trapped).toBe(false);
  });

  it('springs the trap on anything typed into the hidden field', () => {
    expect(readContactForm(formData({ [CONTACT_TRAP_FIELD]: 'https://spam.example' })).trapped).toBe(true);
    expect(readContactForm(formData({ [CONTACT_TRAP_FIELD]: '   ' })).trapped).toBe(false);
  });

  it('ignores a file posted in place of a field', () => {
    const form = new FormData();
    form.set('message', new Blob(['x']), 'x.txt');
    expect(readContactForm(form).values.message).toBe('');
  });
});

describe('validateContact', () => {
  it('accepts a complete message and hands it back trimmed', () => {
    const result = validateContact(values({ name: '  Claire Dubois ', phone: ' 06 12 34 56 78 ' }), REASONS);
    expect(result).toEqual({
      ok: true,
      message: values({ phone: '06 12 34 56 78' }),
    });
  });

  it('names every missing field at once', () => {
    const result = validateContact({ name: ' ', email: '', phone: '', reason: '', message: '\n' }, REASONS);
    expect(result).toEqual({
      ok: false,
      errors: {
        name: 'contact.error.name.required',
        email: 'contact.error.email.required',
        reason: 'contact.error.reason.required',
        message: 'contact.error.message.required',
      },
    });
  });

  it('keeps the phone optional, and refuses one that is not a number', () => {
    expect(validateContact(values({ phone: '' }), REASONS).ok).toBe(true);
    expect(validateContact(values({ phone: '+33 (0)6 12-34.56.78' }), REASONS).ok).toBe(true);
    for (const phone of ['appelez-moi', '12 34', '0'.repeat(CONTACT_LIMITS.phone + 1)]) {
      expect(validateContact(values({ phone }), REASONS), phone).toEqual({
        ok: false,
        errors: { phone: 'contact.error.phone.invalid' },
      });
    }
  });

  it('refuses an address that cannot be answered', () => {
    for (const email of ['claire', 'claire@exemple', 'claire @exemple.fr', `${'a'.repeat(250)}@exemple.fr`]) {
      expect(validateContact(values({ email }), REASONS), email).toEqual({
        ok: false,
        errors: { email: 'contact.error.email.invalid' },
      });
    }
  });

  it('takes a reason from the list only', () => {
    expect(validateContact(values({ reason: 'Partenariat' }), REASONS)).toEqual({
      ok: false,
      errors: { reason: 'contact.error.reason.unknown' },
    });
  });

  it('refuses a name with a line break, which would reach the subject', () => {
    for (const name of ['Claire\nBcc: x@exemple.fr', 'Claire Dubois', 'Claire\u0000']) {
      expect(validateContact(values({ name }), REASONS), JSON.stringify(name)).toEqual({
        ok: false,
        errors: { name: 'contact.error.name.invalid' },
      });
    }
  });

  it('refuses rather than truncates, counting characters as the visitor sees them', () => {
    expect(validateContact(values({ name: 'a'.repeat(CONTACT_LIMITS.name + 1) }), REASONS)).toEqual({
      ok: false,
      errors: { name: 'contact.error.name.tooLong' },
    });
    expect(validateContact(values({ message: 'é'.repeat(CONTACT_LIMITS.message + 1) }), REASONS)).toEqual({
      ok: false,
      errors: { message: 'contact.error.message.tooLong' },
    });
    // Two UTF-16 units each, one character each: the limit is not halved.
    expect(validateContact(values({ message: '🧵'.repeat(CONTACT_LIMITS.message) }), REASONS).ok).toBe(true);
  });

  it('keeps line breaks and tabs in a message, and refuses other controls', () => {
    expect(validateContact(values({ message: 'un\n\tdeux' }), REASONS).ok).toBe(true);
    expect(validateContact(values({ message: 'un\u0007deux' }), REASONS)).toEqual({
      ok: false,
      errors: { message: 'contact.error.message.invalid' },
    });
  });
});

describe('the reasons', () => {
  it('offers the defaults until the merchant writes a list', () => {
    expect(defaultContactReasons()).toEqual(['Renseignement', 'Commande', 'Devis', 'Réclamation', 'Autre']);
    expect(contactReasons(null)).toEqual(defaultContactReasons());
    expect(contactReasons([])).toEqual(defaultContactReasons());
    expect(contactReasons(REASONS)).toEqual(REASONS);
  });

  it('reads the merchant’s list one per line, empty meaning the defaults', () => {
    expect(parseReasonsInput('Renseignement\r\n\n  Sur   mesure \nAutre\n')).toEqual({
      ok: true,
      reasons: ['Renseignement', 'Sur mesure', 'Autre'],
    });
    expect(parseReasonsInput(' \n \n')).toEqual({ ok: true, reasons: null });
  });

  it('refuses a list it would have to cut', () => {
    const many = Array.from({ length: CONTACT_LIMITS.reasons + 1 }, (_, i) => `Motif ${i}`).join('\n');
    expect(parseReasonsInput(many)).toEqual({ ok: false, error: 'admin.settings.contact.error.tooManyReasons' });
    expect(parseReasonsInput('a'.repeat(CONTACT_LIMITS.reason + 1))).toEqual({
      ok: false,
      error: 'admin.settings.contact.error.reasonTooLong',
    });
    expect(parseReasonsInput('Devis\ndevis')).toEqual({
      ok: false,
      error: 'admin.settings.contact.error.duplicateReason',
    });
  });
});

describe('isContactAddress', () => {
  it('accepts one address on one line, and nothing else', () => {
    expect(isContactAddress('boutique@exemple.fr')).toBe(true);
    expect(isContactAddress('a@exemple.fr, b@exemple.fr')).toBe(false);
    expect(isContactAddress('boutique@exemple.fr\r\nBcc: x@exemple.fr')).toBe(false);
    expect(isContactAddress('')).toBe(false);
  });
});
