import { describe, it, expect } from 'vitest';
import { coverComposedEnabled, ensembleBooksEnabled } from './outing-v2';

describe('X17 web flags', () => {
  it('coverComposedEnabled defaults off and honors true/1', () => {
    expect(coverComposedEnabled({})).toBe(false);
    expect(coverComposedEnabled({ COVER_COMPOSED_ENABLED: 'true' })).toBe(true);
    expect(coverComposedEnabled({ COVER_COMPOSED_ENABLED: '1' })).toBe(true);
    expect(coverComposedEnabled({ COVER_COMPOSED_ENABLED: 'false' })).toBe(false);
  });
  it('ensembleBooksEnabled defaults off and honors true/1', () => {
    expect(ensembleBooksEnabled({})).toBe(false);
    expect(ensembleBooksEnabled({ ENSEMBLE_BOOKS_ENABLED: 'true' })).toBe(true);
    expect(ensembleBooksEnabled({ ENSEMBLE_BOOKS_ENABLED: ' TRUE ' })).toBe(true);
  });
});
