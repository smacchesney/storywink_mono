import { describe, it, expect } from 'vitest';
import { patchFlipPrevPoint, type PageFlipLike } from './pageflip-fixes';

/**
 * A pure fake of the page-flip instance surface the patch touches. The
 * original flipPrev throws on purpose: the wrapper must build the point itself
 * and never delegate to the original (idempotent re-wrapping relies on this).
 */
function makeFake(initialRect: { left: number; height: number }) {
  const flipCalls: Array<{ x: number; y: number }> = [];
  let rect = initialRect;
  const pf = {
    getBoundsRect: () => rect,
    flipController: {
      flip: (pos: { x: number; y: number }) => {
        flipCalls.push(pos);
      },
      flipPrev: (_corner: 'top' | 'bottom') => {
        throw new Error('original flipPrev should never be called by the wrapper');
      },
    },
    _flipCalls: flipCalls,
    _setRect: (next: { left: number; height: number }) => {
      rect = next;
    },
  };
  return pf;
}

describe('patchFlipPrevPoint', () => {
  it('portrait-shifted rect: point lands on book-x 10 via rect.left + 10', () => {
    const pf = makeFake({ left: -468, height: 600 });
    expect(patchFlipPrevPoint(pf)).toBe(true);
    pf.flipController.flipPrev('top');
    expect(pf._flipCalls).toEqual([{ x: -458, y: 1 }]);
  });

  it('spread rect (left 0): identical to the engine default', () => {
    const pf = makeFake({ left: 0, height: 550 });
    patchFlipPrevPoint(pf);
    pf.flipController.flipPrev('top');
    expect(pf._flipCalls).toEqual([{ x: 10, y: 1 }]);
  });

  it("corner 'bottom' uses y = height - 2", () => {
    const pf = makeFake({ left: 0, height: 600 });
    patchFlipPrevPoint(pf);
    pf.flipController.flipPrev('bottom');
    expect(pf._flipCalls).toEqual([{ x: 10, y: 598 }]);
  });

  it("defaults the corner to 'top' when called with no argument", () => {
    const pf = makeFake({ left: -100, height: 400 });
    patchFlipPrevPoint(pf);
    (pf.flipController.flipPrev as unknown as () => void)();
    expect(pf._flipCalls).toEqual([{ x: -90, y: 1 }]);
  });

  it('reads the bounds rect at call time, not at patch time', () => {
    const pf = makeFake({ left: 0, height: 550 });
    patchFlipPrevPoint(pf);
    pf.flipController.flipPrev('top');
    pf._setRect({ left: -100, height: 400 });
    pf.flipController.flipPrev('top');
    expect(pf._flipCalls).toEqual([
      { x: 10, y: 1 },
      { x: -90, y: 1 },
    ]);
  });

  it('is idempotent: re-patching still fires exactly one flip, never the original', () => {
    const pf = makeFake({ left: 0, height: 550 });
    expect(patchFlipPrevPoint(pf)).toBe(true);
    expect(patchFlipPrevPoint(pf)).toBe(true);
    pf.flipController.flipPrev('top');
    expect(pf._flipCalls).toEqual([{ x: 10, y: 1 }]);
  });

  it('returns false and leaves the object untouched when flipController is missing', () => {
    const pf = { getBoundsRect: () => ({ left: 0, height: 550 }) };
    expect(patchFlipPrevPoint(pf as PageFlipLike)).toBe(false);
    expect((pf as PageFlipLike).flipController).toBeUndefined();
  });

  it('returns false when flip is not a function', () => {
    const original = () => {};
    const pf = {
      getBoundsRect: () => ({ left: 0, height: 550 }),
      flipController: { flip: 42 as unknown as () => void, flipPrev: original },
    };
    expect(patchFlipPrevPoint(pf as unknown as PageFlipLike)).toBe(false);
    // flipPrev left as the original reference.
    expect(pf.flipController.flipPrev).toBe(original);
  });

  it('returns false when getBoundsRect is missing or not a function', () => {
    expect(patchFlipPrevPoint(null)).toBe(false);
    expect(patchFlipPrevPoint(undefined)).toBe(false);
    expect(patchFlipPrevPoint({} as PageFlipLike)).toBe(false);
  });
});
