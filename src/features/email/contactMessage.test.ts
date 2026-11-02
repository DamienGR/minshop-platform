import { describe, expect, it } from 'vitest';
import { contactMessageEmail } from './contactMessage';

const message = {
  name: 'Claire <b>Dubois</b>',
  email: 'claire@exemple.fr',
  phone: '06 12 34 56 78',
  reason: 'Sur mesure',
  message: 'Bonjour,\n<script>alert(1)</script> un sac & un prénom ?',
};

const email = () => contactMessageEmail(message, 'atelier@exemple.fr', 'Atelier Essai', 'https://boutique.test/pages/contact');

describe('contactMessageEmail', () => {
  it('goes to the merchant and is answered to the visitor', () => {
    const sent = email();
    expect(sent.to).toBe('atelier@exemple.fr');
    expect(sent.replyTo).toBe('claire@exemple.fr');
  });

  it('names the reason in the subject, first', () => {
    expect(email().subject).toBe('Contact : Sur mesure (Claire <b>Dubois</b>)');
  });

  it('escapes everything the visitor typed in the HTML part, line breaks kept', () => {
    const { html } = email();
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; un sac &amp; un prénom ?');
    expect(html).toContain('Bonjour,<br>');
    expect(html).toContain('Claire &lt;b&gt;Dubois&lt;/b&gt;');
    expect(html).toContain('06 12 34 56 78');
  });

  it('carries the message as written in the text part', () => {
    const { text } = email();
    expect(text).toContain('Nom : Claire <b>Dubois</b>');
    expect(text).toContain('Motif : Sur mesure');
    expect(text).toContain(message.message);
    expect(text).toContain('Envoyé depuis https://boutique.test/pages/contact');
  });

  it('leaves out the phone line when none was given', () => {
    const sent = contactMessageEmail({ ...message, phone: '' }, 'atelier@exemple.fr', 'Atelier Essai', 'https://boutique.test/');
    expect(sent.text).not.toContain('Téléphone');
    expect(sent.html).not.toContain('Téléphone');
  });
});
