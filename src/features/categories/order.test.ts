import { describe, it, expect } from 'vitest';
import { arrivalPositions, compareCategories, isRanged, moveWithinFamily, type Ranked } from './order';

const c = (id: number, name: string, position = 0): Ranked => ({ id, name, position });
const names = (family: Ranked[]) => [...family].sort(compareCategories).map((x) => x.name);

// A shop's top level (ticket #228): the alphabet puts Zéro déchet last.
const UNIVERS = [
  c(1, 'Carte cadeau'),
  c(2, 'Créations bébés'),
  c(3, 'Univers féminin'),
  c(4, 'Zéro déchet'),
];

describe('compareCategories', () => {
  it('sorts a family never ranged by name, in the French collation', () => {
    expect(names([c(1, 'Zéro déchet'), c(2, 'Écharpes'), c(3, 'Bien-être')])).toEqual([
      'Bien-être',
      'Écharpes',
      'Zéro déchet',
    ]);
  });

  it('puts the position first, the name only between equals', () => {
    expect(names([c(1, 'Accessoires', 2), c(2, 'Sacs et pochettes', 1), c(3, 'Bien-être', 2)])).toEqual([
      'Sacs et pochettes',
      'Accessoires',
      'Bien-être',
    ]);
  });
});

describe('isRanged', () => {
  it('is a position above 0, so a ranged family shrunk to one member stays ranged', () => {
    expect(isRanged(UNIVERS)).toBe(false);
    expect(isRanged([])).toBe(false);
    expect(isRanged([c(4, 'Zéro déchet', 1)])).toBe(true);
  });
});

describe('moveWithinFamily', () => {
  it('moves one rank in a family never ranged, where every position is 0', () => {
    // Swapping two equal positions would move nothing: the order returned is
    // the one the caller writes, 1 to n, for the whole family.
    expect(moveWithinFamily(UNIVERS, 4, 'up')).toEqual([1, 2, 4, 3]);
    expect(moveWithinFamily(UNIVERS, 1, 'down')).toEqual([2, 1, 3, 4]);
  });

  it('takes the neighbour the merchant sees, from the sorted family', () => {
    const ranged = [c(1, 'Carte cadeau', 4), c(2, 'Créations bébés', 2), c(3, 'Univers féminin', 3), c(4, 'Zéro déchet', 1)];
    expect(moveWithinFamily(ranged, 1, 'up')).toEqual([4, 2, 1, 3]);
  });

  it('refuses the first upward, the last downward, and a stranger', () => {
    expect(moveWithinFamily(UNIVERS, 1, 'up')).toBeNull();
    expect(moveWithinFamily(UNIVERS, 4, 'down')).toBeNull();
    expect(moveWithinFamily(UNIVERS, 99, 'up')).toBeNull();
    expect(moveWithinFamily([], 1, 'down')).toBeNull();
  });

  it('reaches the order of the shop’s current site from the alphabet', () => {
    let family = UNIVERS;
    const apply = (order: number[] | null) => {
      family = family.map((x) => ({ ...x, position: order!.indexOf(x.id) + 1 }));
    };
    apply(moveWithinFamily(family, 4, 'up'));
    apply(moveWithinFamily(family, 4, 'up'));
    apply(moveWithinFamily(family, 4, 'up'));
    apply(moveWithinFamily(family, 1, 'down'));
    apply(moveWithinFamily(family, 1, 'down'));
    expect(names(family)).toEqual(['Zéro déchet', 'Créations bébés', 'Univers féminin', 'Carte cadeau']);
  });
});

describe('arrivalPositions', () => {
  it('puts newcomers last in a ranged family, in their own order', () => {
    const family = [c(1, 'Zéro déchet', 1), c(2, 'Créations bébés', 2)];
    const arriving = [c(7, 'Bien-être', 2), c(8, 'Sacs et pochettes', 1), c(9, 'Accessoires', 3)];
    expect([...arrivalPositions(family, arriving)]).toEqual([
      [8, 3],
      [7, 4],
      [9, 5],
    ]);
  });

  it('puts them at their alphabetical place in a family never ranged', () => {
    const arriving = [c(7, 'Bien-être', 2), c(8, 'Sacs et pochettes', 1)];
    expect([...arrivalPositions(UNIVERS, arriving).values()]).toEqual([0, 0]);
  });

  it('lets them keep their order when nobody else is in the family', () => {
    const ranged = [c(7, 'Bien-être', 2), c(8, 'Sacs et pochettes', 1)];
    expect([...arrivalPositions([], ranged)]).toEqual([
      [8, 1],
      [7, 2],
    ]);
    const unranged = [c(7, 'Bien-être'), c(8, 'Sacs et pochettes')];
    expect([...arrivalPositions([], unranged).values()]).toEqual([0, 0]);
  });
});
