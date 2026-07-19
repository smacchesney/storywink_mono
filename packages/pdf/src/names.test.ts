import { describe, it, expect } from 'vitest';
import { formatCastNames, castDisplayName } from './names.js';
import type { BookWithPages } from './types.js';

describe('formatCastNames (X17 A2)', () => {
  it('en: 1-4 names join with commas and a final ampersand', () => {
    expect(formatCastNames(['Leo'], 'en')).toBe('Leo');
    expect(formatCastNames(['Leo', 'Maya'], 'en')).toBe('Leo & Maya');
    expect(formatCastNames(['Leo', 'Maya', 'Sam'], 'en')).toBe('Leo, Maya & Sam');
  });
  it('en: overflow beyond 4 becomes "and friends"', () => {
    expect(formatCastNames(['A', 'B', 'C', 'D', 'E'], 'en')).toBe('A, B, C, D & friends');
  });
  it('ja: joins with と, overflow appends と おともだち', () => {
    expect(formatCastNames(['レオ', 'マヤ'], 'ja')).toBe('レオと マヤ');
    expect(formatCastNames(['ア', 'イ', 'ウ', 'エ', 'オ'], 'ja')).toBe(
      'アと イと ウと エと おともだち',
    );
  });
  it('dedupes, trims, and returns null for nothing', () => {
    expect(formatCastNames([' Leo ', 'Leo', ''], 'en')).toBe('Leo');
    expect(formatCastNames([], 'en')).toBeNull();
  });
});

describe('castDisplayName (X17 A2)', () => {
  const ensembleBook = {
    castMode: 'ensemble',
    castMemberIds: ['child_1', 'child_2', 'pet_1'],
    characterIdentity: {
      characters: [
        { characterId: 'child_1', name: 'Leo' },
        { characterId: 'child_2', name: 'Maya' },
        { characterId: 'pet_1', name: null }, // unnamed — excluded
      ],
    },
    childName: 'Leo',
    language: 'en',
  } as unknown as BookWithPages;

  it('ensemble: lists named members in castMemberIds order', () => {
    expect(castDisplayName(ensembleBook)).toBe('Leo & Maya');
  });
  it('ensemble with zero named members falls back to childName', () => {
    const book = { ...ensembleBook, castMemberIds: ['pet_1'] } as unknown as BookWithPages;
    expect(castDisplayName(book)).toBe('Leo');
  });
  it('ensemble with a single named member falls back to childName (min 2 to print)', () => {
    // One resolvable member (Maya) but childName is Leo — a lone member is a
    // star, not an ensemble, so the print must be childName, never the member.
    const book = { ...ensembleBook, castMemberIds: ['child_2'] } as unknown as BookWithPages;
    expect(castDisplayName(book)).toBe('Leo');
  });
  it('ensemble with two ids but only one resolving to a name falls back to childName', () => {
    // Two member ids, but pet_1 is unnamed — only Maya resolves. The gate counts
    // RESOLVED names (what prints), so one name < 2 → childName.
    const book = {
      ...ensembleBook,
      castMemberIds: ['child_2', 'pet_1'],
    } as unknown as BookWithPages;
    expect(castDisplayName(book)).toBe('Leo');
  });
  it('star/legacy books return childName untouched (byte-identical path)', () => {
    expect(
      castDisplayName({ castMode: 'star', childName: 'Kai' } as unknown as BookWithPages),
    ).toBe('Kai');
    expect(castDisplayName({ childName: 'Kai' } as unknown as BookWithPages)).toBe('Kai');
  });
});
