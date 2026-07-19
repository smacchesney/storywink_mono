import { describe, it, expect } from 'vitest';
import { stripThumbFlags } from './photo-strip-flags';

describe('stripThumbFlags', () => {
  it('legacy (photo cover): position 0 is the badged, undeletable cover', () => {
    expect(stripThumbFlags(0, 5, true)).toEqual({ isCover: true, removable: false });
    expect(stripThumbFlags(3, 5, true)).toEqual({ isCover: false, removable: true });
  });
  it('composed cover: no badge anywhere, min-count anchors deletion', () => {
    expect(stripThumbFlags(0, 5, false)).toEqual({ isCover: false, removable: true });
    expect(stripThumbFlags(1, 2, false)).toEqual({ isCover: false, removable: false });
  });
});
