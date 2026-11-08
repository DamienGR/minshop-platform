import { describe, expect, it } from 'vitest';
import { oneLine } from './spaces';

// Tickets #175 and #218: `\s` matches the no-break spaces too, and a text
// folded with it could wrap before « : » or leave a « » » alone on a line.
describe('oneLine', () => {
  it('folds every run of breaking whitespace to one space and trims the ends', () => {
    expect(oneLine('  Sac  à dos\r\n\tbrodé \n')).toBe('Sac à dos brodé');
    expect(oneLine(' \n\t ')).toBe('');
  });

  it('keeps the no-break spaces where they were typed', () => {
    expect(oneLine('Une question\u202f?  Écrivez-moi\u00a0:\r\nici')).toBe('Une question\u202f? Écrivez-moi\u00a0: ici');
    expect(oneLine('«\u00a0Lin lavé\u00a0»')).toBe('«\u00a0Lin lavé\u00a0»');
    expect(oneLine('Prix\u2007: 12\u00a0€')).toBe('Prix\u2007: 12\u00a0€');
  });

  it('drops a no-break space at either end, where it holds nothing', () => {
    expect(oneLine('\u00a0Atelier\u202f')).toBe('Atelier');
  });
});
