import { describe, expect, it } from 'vitest';
import { mediaSideOf, toggleImageSide } from './mediaSide';

describe('mediaSideOf', () => {
  it('reads the two words, whatever their case or spaces', () => {
    expect(mediaSideOf('gauche')).toBe('left');
    expect(mediaSideOf('droite')).toBe('right');
    expect(mediaSideOf('  Droite ')).toBe('right');
  });

  it('reads no side in any other title, or none', () => {
    expect(mediaSideOf('à gauche')).toBeNull();
    expect(mediaSideOf('constructor')).toBeNull();
    expect(mediaSideOf('')).toBeNull();
    expect(mediaSideOf(undefined)).toBeNull();
  });
});

describe('toggleImageSide — the editor’s « À gauche » and « À droite »', () => {
  const image = '![Mes mains](/images/media/a.webp)';

  it('gives an image without a title the side', () => {
    const edit = toggleImageSide(image, 0, 'gauche');
    expect(edit?.line).toBe('![Mes mains](/images/media/a.webp "gauche")');
    expect(edit && edit.line.slice(edit.start, edit.end)).toBe(edit?.line);
  });

  it('moves it to the other side', () => {
    expect(toggleImageSide('![Mes mains](/images/media/a.webp "gauche")', 0, 'droite')?.line).toBe(
      '![Mes mains](/images/media/a.webp "droite")',
    );
  });

  it('puts it back at full width on a second press', () => {
    const once = toggleImageSide(image, 0, 'droite')!;
    expect(toggleImageSide(once.line, 0, 'droite')?.line).toBe(image);
  });

  it('replaces any other title, the one an image can have', () => {
    expect(toggleImageSide('![a](/images/media/a.webp \'Un titre\')', 0, 'gauche')?.line).toBe(
      '![a](/images/media/a.webp "gauche")',
    );
  });

  it('keeps an alt with escaped brackets as it was', () => {
    expect(toggleImageSide('![Le \\[bleu\\]](/images/media/a.webp)', 0, 'gauche')?.line).toBe(
      '![Le \\[bleu\\]](/images/media/a.webp "gauche")',
    );
  });

  it('picks the image under the caret when the line holds two', () => {
    const line = `${image} ![Autre](/images/media/b.webp)`;
    const edit = toggleImageSide(line, line.length - 3, 'gauche')!;
    expect(edit.line).toBe(`${image} ![Autre](/images/media/b.webp "gauche")`);
    expect(edit.line.slice(edit.start, edit.end)).toBe('![Autre](/images/media/b.webp "gauche")');
  });

  it('and the first one when the caret is in neither', () => {
    const line = `Texte ${image}`;
    expect(toggleImageSide(line, 0, 'gauche')?.line).toBe(`Texte ${image.slice(0, -1)} "gauche")`);
  });

  it('finds nothing on a line without an image, a link included', () => {
    expect(toggleImageSide('Un paragraphe.', 3, 'gauche')).toBeNull();
    expect(toggleImageSide('[Un lien](https://example.com)', 3, 'gauche')).toBeNull();
  });
});
