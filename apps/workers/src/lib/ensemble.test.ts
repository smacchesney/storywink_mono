import { describe, it, expect } from 'vitest';
import { ensembleBooksEnabled, parseCastMemberIds, ensembleMemberIds } from './ensemble.js';

describe('ensemble helpers (X17 A2)', () => {
  it('flag defaults off and honors true/1', () => {
    expect(ensembleBooksEnabled({})).toBe(false);
    expect(ensembleBooksEnabled({ ENSEMBLE_BOOKS_ENABLED: 'true' })).toBe(true);
    expect(ensembleBooksEnabled({ ENSEMBLE_BOOKS_ENABLED: '1' })).toBe(true);
  });
  it('parseCastMemberIds is defensive and dedupes', () => {
    expect(parseCastMemberIds(null)).toEqual([]);
    expect(parseCastMemberIds('child_1')).toEqual([]);
    expect(parseCastMemberIds(['child_1', 'child_1', 42, '', 'pet_1'])).toEqual([
      'child_1',
      'pet_1',
    ]);
  });
  it('ensembleMemberIds: flag + castMode + >=2 members, else null', () => {
    const env = { ENSEMBLE_BOOKS_ENABLED: 'true' };
    const book = { castMode: 'ensemble', castMemberIds: ['child_1', 'child_2'] };
    expect(ensembleMemberIds(book, env)).toEqual(['child_1', 'child_2']);
    expect(ensembleMemberIds(book, {})).toBeNull(); // flag off → star path
    expect(ensembleMemberIds({ ...book, castMode: 'star' }, env)).toBeNull();
    expect(ensembleMemberIds({ castMode: 'ensemble', castMemberIds: ['solo'] }, env)).toBeNull();
  });
});
