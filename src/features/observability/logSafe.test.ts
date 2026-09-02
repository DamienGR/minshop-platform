import { describe, it, expect } from 'vitest';
import { logSafe } from './logSafe';
import { generateAccessToken } from '../ids/token';

describe('logSafe', () => {
  it('masks an e-mail address anywhere in the message', () => {
    expect(logSafe(new Error('Resend refused claire.dubois@example.fr'))).toBe(
      'Resend refused <email>',
    );
    expect(logSafe('to=a@b.co cc=c@d.io')).toBe('to=<email> cc=<email>');
  });

  it('masks a guest access token — the credential for a whole order', () => {
    const token = generateAccessToken();
    expect(logSafe(`delivery of https://shop.test/order/${token} failed`)).toBe(
      'delivery of https://shop.test/order/otk_REDACTED failed',
    );
  });

  it('keeps everything an operator needs to act', () => {
    expect(logSafe(new Error('Resend send failed (503)'))).toBe('Resend send failed (503)');
  });

  it('drops the stack: the message is the part written for a human', () => {
    const error = new Error('boom');
    expect(logSafe(error)).toBe('boom');
    expect(logSafe(error)).not.toContain('logSafe.test');
  });

  it('names an error that carries no message', () => {
    expect(logSafe(new TypeError())).toBe('TypeError');
  });

  it('renders a non-Error throw rather than "[object Object]"', () => {
    expect(logSafe({ status: 422, to: 'a@b.co' })).toBe('{"status":422,"to":"<email>"}');
    expect(logSafe(undefined)).toBe('undefined');
  });

  it('survives a value JSON cannot serialize', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(logSafe(cyclic)).toBe('[object Object]');
  });

  it('caps a provider that answers with a page of text', () => {
    const long = logSafe(new Error('x'.repeat(1000)));
    expect(long.length).toBe(301);
    expect(long.endsWith('…')).toBe(true);
  });
});
