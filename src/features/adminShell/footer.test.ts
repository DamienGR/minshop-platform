import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';
import { CORE_VERSION, supportHref } from './footer';

describe('the Admin footer (ticket #186)', () => {
  it('names the core version package.json carries', () => {
    expect(CORE_VERSION).toBe(packageJson.version);
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('writes to the declared address, with a subject naming the shop', () => {
    const href = supportHref(' support@agence.example ', 'Atelier Exemple : une difficulté (socle v0.6.0)');
    expect(href).toBe(
      'mailto:support@agence.example?subject=Atelier%20Exemple%20%3A%20une%20difficult%C3%A9%20(socle%20v0.6.0)',
    );
  });

  it('shows no link without an address', () => {
    expect(supportHref('', 'sujet')).toBeNull();
    expect(supportHref('   ', 'sujet')).toBeNull();
  });

  it('shows no link for something that is not one address', () => {
    for (const address of ['support', 'support@', '@agence.example', 'a@b', 'a@b.fr, c@d.fr', 'a@b.fr;c@d.fr', 'a b@c.fr']) {
      expect(supportHref(address, 'sujet'), address).toBeNull();
    }
  });
});
