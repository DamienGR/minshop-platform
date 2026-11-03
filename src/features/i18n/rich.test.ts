import { describe, expect, it } from 'vitest';
import { richSegments } from './rich';
import { tRich } from './index';

describe('richSegments', () => {
  it('splits a sentence into plain and marked runs, spaces kept with the text', () => {
    expect(richSegments('Facultatif. **Les variantes** sont des choix.')).toEqual([
      { text: 'Facultatif. ', mark: null },
      { text: 'Les variantes', mark: 'strong' },
      { text: ' sont des choix.', mark: null },
    ]);
  });

  it('reads code and link marks', () => {
    expect(richSegments('Comme `UTC` ou un [widget Turnstile].')).toEqual([
      { text: 'Comme ', mark: null },
      { text: 'UTC', mark: 'code' },
      { text: ' ou un ', mark: null },
      { text: 'widget Turnstile', mark: 'link' },
      { text: '.', mark: null },
    ]);
  });

  it('leaves an unclosed mark as text', () => {
    expect(richSegments('2 ** 3 et un [crochet')).toEqual([{ text: '2 ** 3 et un [crochet', mark: null }]);
  });

  it('returns a message without marks whole', () => {
    expect(richSegments('Aucune marque.')).toEqual([{ text: 'Aucune marque.', mark: null }]);
  });
});

describe('tRich', () => {
  it('fills placeholders after reading the marks, so a value is never a mark', () => {
    // A merchant's button label, a store name: input, not markup.
    expect(tRich('admin.products.section.saveHint', { bouton: '**Envoyer**' })).toEqual([
      { text: 'Tout ce qui se trouve ici s’enregistre avec le bouton ', mark: null },
      { text: '**Envoyer**', mark: 'strong' },
      { text: ' en haut de la page.', mark: null },
    ]);
  });
});
