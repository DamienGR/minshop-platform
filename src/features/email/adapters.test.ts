import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudflareEmail, type EmailBinding } from './cloudflare';
import { createResendEmail } from './resend';

const from = { email: 'boutique@exemple.fr', name: 'Atelier Essai' };
const message = { to: 'atelier@exemple.fr', subject: 'Objet', html: '<p>x</p>', text: 'x' };

afterEach(() => vi.unstubAllGlobals());

describe('replyTo through the adapters (ADR 0025)', () => {
  it('Resend sends it as reply_to, and nothing when absent', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response('{}', { status: 200 });
    });
    const resend = createResendEmail('re_test', from);
    await resend.send({ ...message, replyTo: 'claire@exemple.fr' });
    await resend.send(message);
    expect(bodies[0].reply_to).toBe('claire@exemple.fr');
    expect('reply_to' in bodies[1]).toBe(false);
  });

  it('the Cloudflare binding gets its own replyTo field', async () => {
    const sent: Parameters<EmailBinding['send']>[0][] = [];
    const binding: EmailBinding = { send: async (m) => void sent.push(m) };
    const cloudflare = createCloudflareEmail(binding, from);
    await cloudflare.send({ ...message, replyTo: 'claire@exemple.fr' });
    await cloudflare.send(message);
    expect(sent[0].replyTo).toBe('claire@exemple.fr');
    expect('replyTo' in sent[1]).toBe(false);
  });
});
