import { describe, it, expect } from 'vitest';
import { buildTree, childrenOf, flattenTree, type Category } from './db';

const category = (id: number, name: string, overrides: Partial<Category> = {}): Category => ({
  id,
  public_id: `cat_k7m2qx8vn${id}`,
  name,
  slug: name.toLowerCase(),
  parent_id: null,
  image_key: null,
  description: null,
  seo_title: null,
  seo_description: null,
  position: 0,
  hidden: 0,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

// Ticket #228: the storefront (`childrenOf()`) and the admin (`buildTree()`)
// read one order, the rule of order.ts.
const CATS = [
  category(1, 'Zéro déchet', { position: 1 }),
  category(2, 'Carte cadeau', { position: 3 }),
  category(3, 'Univers féminin', { position: 2 }),
  category(4, 'Accessoires', { parent_id: 3 }),
  category(5, 'Sacs et pochettes', { parent_id: 3 }),
  category(6, 'Bien-être', { parent_id: 3 }),
];

describe('childrenOf', () => {
  it('lists a family by position, and one never ranged by name', () => {
    expect(childrenOf(CATS, null).map((c) => c.name)).toEqual([
      'Zéro déchet',
      'Univers féminin',
      'Carte cadeau',
    ]);
    expect(childrenOf(CATS, 3).map((c) => c.name)).toEqual([
      'Accessoires',
      'Bien-être',
      'Sacs et pochettes',
    ]);
  });
});

describe('buildTree and flattenTree', () => {
  it('give the admin the storefront’s order, and the first and last of each family', () => {
    const rows = flattenTree(buildTree(CATS));
    expect(rows.map((r) => [r.name, r.depth, r.first, r.last])).toEqual([
      ['Zéro déchet', 0, true, false],
      ['Univers féminin', 0, false, false],
      ['Accessoires', 1, true, false],
      ['Bien-être', 1, false, false],
      ['Sacs et pochettes', 1, false, true],
      ['Carte cadeau', 0, false, true],
    ]);
  });

  it('marks an only child both first and last', () => {
    const [row] = flattenTree(buildTree([category(9, 'Seule')]));
    expect([row.first, row.last]).toEqual([true, true]);
  });

  // Ticket #240: hiding a category hides its branch, and the admin says which
  // ones are off the storefront, by their own box or with their parent.
  it('marks a hidden category and everything under it as concealed, nothing else', () => {
    const rows = flattenTree(
      buildTree([
        ...CATS.map((c) => (c.id === 3 ? { ...c, hidden: 1 } : c)),
        category(7, 'Pochettes zippées', { parent_id: 5 }),
      ]),
    );
    expect(rows.map((r) => [r.name, r.hidden, r.concealed])).toEqual([
      ['Zéro déchet', false, false],
      ['Univers féminin', true, true],
      ['Accessoires', false, true],
      ['Bien-être', false, true],
      ['Sacs et pochettes', false, true],
      ['Pochettes zippées', false, true],
      ['Carte cadeau', false, false],
    ]);
  });
});
