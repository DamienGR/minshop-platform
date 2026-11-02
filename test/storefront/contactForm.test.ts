import { describe, expect, it } from 'vitest';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import ContactForm from '../../src/features/storefront/controls/ContactForm.astro';
import type { ContactFormModel } from '../../src/features/storefront/models';
import { CONTACT_LIMITS, CONTACT_TRAP_FIELD } from '../../src/features/contact/form';

const model = (overrides: Partial<ContactFormModel> = {}): ContactFormModel => ({
  action: '/pages/contact',
  reasons: ['Renseignement', 'Sur mesure'],
  values: { name: '', email: '', phone: '', reason: '', message: '' },
  errors: {},
  formError: null,
  sent: false,
  ...overrides,
});

const render = async (value: ContactFormModel, slots?: Record<string, string>) => {
  const container = await AstroContainer.create();
  return container.renderToString(ContactForm as never, { props: { model: value }, slots });
};

describe('the contact form control (ADR 0025)', () => {
  it('is a plain POST form to its page, with the field names the server reads', async () => {
    const html = await render(model());
    expect(html).toMatch(/<form[^>]*method="POST"[^>]*action="\/pages\/contact#contact"/);
    for (const name of ['name', 'email', 'phone', 'reason', 'message']) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain(`maxlength="${CONTACT_LIMITS.message}"`);
    expect(html).toContain('autocomplete="email"');
  });

  it('hides the trap from people three ways', async () => {
    const html = await render(model());
    const trap = html.match(/<div aria-hidden="true" class="sr-only">[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(trap).toContain(`name="${CONTACT_TRAP_FIELD}"`);
    expect(trap).toContain('tabindex="-1"');
    expect(trap).toContain('autocomplete="off"');
  });

  it('offers the reasons in order, after a choice that is not one', async () => {
    const html = await render(model());
    const options = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    expect(options).toEqual(['', 'Renseignement', 'Sur mesure']);
  });

  it('hands back what was typed, escaped, and links each error to its field', async () => {
    const html = await render(
      model({
        values: { name: '"><script>x</script>', email: 'claire@exemple', phone: '', reason: 'Sur mesure', message: '</textarea><b>x</b>' },
        errors: { email: 'Saisissez une adresse e-mail valide.' },
      }),
    );
    // Inside a quoted attribute only the quote can end it, and it is escaped.
    expect(html).toContain('value="&quot;><script>x</script>"');
    expect(html).not.toContain('value=""><script>');
    expect(html).not.toContain('</textarea><b>');
    expect(html).toContain('&lt;/textarea&gt;&lt;b&gt;x&lt;/b&gt;');
    expect(html).toMatch(/<option value="Sur mesure" selected/);
    expect(html).toMatch(/id="contact-email"[^>]*aria-invalid="true"[^>]*aria-describedby="contact-email-error"/);
    expect(html).toContain('id="contact-email-error"');
    expect(html).not.toContain('contact-name-error');
  });

  it('says a refusal that is no field’s as an alert', async () => {
    const html = await render(model({ formError: 'Votre message n’a pas pu être envoyé.' }));
    expect(html).toMatch(/role="alert"[^>]*>\s*Votre message n’a pas pu être envoyé\./);
  });

  it('puts the challenge inside the form', async () => {
    const html = await render(model(), { challenge: '<div class="cf-turnstile"></div>' });
    expect(html.indexOf('cf-turnstile')).toBeGreaterThan(html.indexOf('<form'));
    expect(html.indexOf('cf-turnstile')).toBeLessThan(html.indexOf('</form>'));
  });

  it('replaces the form with the confirmation once sent', async () => {
    const html = await render(model({ sent: true }));
    expect(html).not.toContain('<form');
    expect(html).toContain('role="status"');
    expect(html).toContain('href="/pages/contact#contact"');
  });
});
