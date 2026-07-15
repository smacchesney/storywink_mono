import { describe, it, expect } from 'vitest';
import { shouldAutoSave } from './pdf-autosave';

describe('shouldAutoSave', () => {
  it('auto-saves on desktop no matter the gesture state (desktop behavior unchanged)', () => {
    // Desktop browsers download a fetched blob without a live gesture, so the
    // tap that opened the dialog stays the only tap needed even after a long
    // server render consumed the transient activation.
    expect(shouldAutoSave(true, false)).toBe(true);
    expect(shouldAutoSave(false, false)).toBe(true);
    expect(shouldAutoSave(undefined, false)).toBe(true);
  });

  it('auto-saves on iOS only while a user gesture is still active', () => {
    expect(shouldAutoSave(true, true)).toBe(true);
  });

  it('skips auto-save on iOS once the transient activation has lapsed', () => {
    // The reported case: a 10s render outlives the gesture, iOS Safari would
    // swallow the synthetic click, so land on the primary Save button instead.
    expect(shouldAutoSave(false, true)).toBe(false);
  });

  it('skips auto-save on iOS when navigator.userActivation is unavailable', () => {
    expect(shouldAutoSave(undefined, true)).toBe(false);
  });
});
