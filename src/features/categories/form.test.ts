import { describe, expect, it } from 'vitest';
import { CATEGORY_DESCRIPTION_MAX, parseCategoryForm } from './form';

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

const description = (value: string) => {
  const parsed = parseCategoryForm(form({ name: 'Sacs', description: value }));
  return 'error' in parsed ? parsed : parsed.data.description;
};

describe('a category’s description', () => {
  it('is one paragraph: line breaks fold to spaces, empty is none', () => {
    expect(description('  Des sacs\r\n\r\ncousus  main. ')).toBe('Des sacs cousus main.');
    expect(description(' \n ')).toBeNull();
  });

  // Ticket #218: shown under the title of the category's page since v0.8.0, it
  // kept none of its no-break spaces, so the line could wrap before « : ».
  it('keeps the no-break spaces of French typography', () => {
    expect(description('Nos «\u00a0cabas\u00a0»\u202f: lin lavé, coutures doubles\u00a0!')).toBe(
      'Nos «\u00a0cabas\u00a0»\u202f: lin lavé, coutures doubles\u00a0!',
    );
  });

  it('is refused past its length, counted after the fold', () => {
    expect(description(`${'é'.repeat(CATEGORY_DESCRIPTION_MAX)}\n\n`)).toBe('é'.repeat(CATEGORY_DESCRIPTION_MAX));
    expect(description('é'.repeat(CATEGORY_DESCRIPTION_MAX + 1))).toEqual({
      error: 'La description ne doit pas dépasser 300 caractères.',
    });
  });
});
