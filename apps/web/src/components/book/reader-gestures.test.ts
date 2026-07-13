import { describe, it, expect } from 'vitest';
import {
  TAP_TRAVEL_PX,
  edgeTapZone,
  galleryDefaultVisible,
  isOnEngineCorner,
  isPhonePortraitViewport,
  isVerticalScrollGesture,
} from './reader-gestures';

describe('edgeTapZone', () => {
  it('left third turns back, right third turns forward', () => {
    expect(edgeTapZone(0.1)).toBe('prev');
    expect(edgeTapZone(0.349)).toBe('prev');
    expect(edgeTapZone(0.651)).toBe('next');
    expect(edgeTapZone(0.9)).toBe('next');
  });

  it('the middle third belongs to reading', () => {
    expect(edgeTapZone(0.35)).toBeNull();
    expect(edgeTapZone(0.5)).toBeNull();
    expect(edgeTapZone(0.65)).toBeNull();
  });
});

describe('isVerticalScrollGesture', () => {
  it('flags a mostly-vertical drag in either direction', () => {
    expect(isVerticalScrollGesture(0, 200)).toBe(true);
    expect(isVerticalScrollGesture(-5, -80)).toBe(true);
    expect(isVerticalScrollGesture(9, 31)).toBe(true);
  });

  it('leaves horizontal swipes and short wobbles to the engine', () => {
    expect(isVerticalScrollGesture(60, 10)).toBe(false); // real swipe
    expect(isVerticalScrollGesture(12, 200)).toBe(false); // diagonal — engine already folding
    expect(isVerticalScrollGesture(0, 30)).toBe(false); // too short to be a scroll
    expect(isVerticalScrollGesture(3, 4)).toBe(false); // a tap
  });

  it('tap travel threshold matches the click handler gate', () => {
    expect(TAP_TRAVEL_PX).toBe(10);
  });
});

describe('isOnEngineCorner — landscape (all four corner squares, diag/5)', () => {
  // Landscape/spread keeps the engine's original four-corner behavior.
  const W = 350;
  const H = 449;
  const dist = Math.hypot(W, H) / 5; // ≈ 113.8

  it('release near the bottom-right corner is inside the square', () => {
    expect(isOnEngineCorner(W - 10, H - 10, W, H, W, 'landscape')).toBe(true);
    expect(isOnEngineCorner(dist - 1, dist - 1, W, H, W, 'landscape')).toBe(true);
  });

  it('edge midpoints and the center are not corners', () => {
    expect(isOnEngineCorner(W / 2, H / 2, W, H, W, 'landscape')).toBe(false);
    expect(isOnEngineCorner(W - 10, H / 2, W, H, W, 'landscape')).toBe(false);
    expect(isOnEngineCorner(W / 2, 10, W, H, W, 'landscape')).toBe(false);
  });

  it('points outside the block never count', () => {
    expect(isOnEngineCorner(-1, 5, W, H, W, 'landscape')).toBe(false);
    expect(isOnEngineCorner(W + 1, H - 5, W, H, W, 'landscape')).toBe(false);
  });

  it('spread mode uses the half-block page width', () => {
    const blockW = 800;
    const pageW = 400;
    const d = Math.hypot(pageW, H) / 5;
    expect(isOnEngineCorner(d - 1, d - 1, blockW, H, pageW, 'landscape')).toBe(true);
    expect(isOnEngineCorner(d + 5, d + 5, blockW, H, pageW, 'landscape')).toBe(false);
    // Left band of the spread still belongs to the engine.
    expect(isOnEngineCorner(d - 1, H - (d - 1), blockW, H, pageW, 'landscape')).toBe(true);
  });
});

describe('isOnEngineCorner — portrait (right corners only; left belongs to the reader)', () => {
  // Portrait phone: single page, block === page width 350×449. The engine's
  // book space is shifted so its left corner squares map to book-middle and it
  // never flips clicks there — the reader owns them (see A2 in the brief).
  const W = 350;
  const H = 449;
  const dist = Math.hypot(W, H) / 5; // ≈ 113.8

  it('right corners still fold-and-flip via the engine', () => {
    expect(isOnEngineCorner(W - 10, 10, W, H, W, 'portrait')).toBe(true); // top-right
    expect(isOnEngineCorner(W - 10, H - 10, W, H, W, 'portrait')).toBe(true); // bottom-right
  });

  it("left corners are the reader's — the engine never flips them in portrait", () => {
    expect(isOnEngineCorner(10, 10, W, H, W, 'portrait')).toBe(false); // top-left
    expect(isOnEngineCorner(10, H - 10, W, H, W, 'portrait')).toBe(false); // bottom-left
    expect(isOnEngineCorner(dist - 1, dist - 1, W, H, W, 'portrait')).toBe(false); // near top-left
  });

  it('edge midpoints and the center are still not corners', () => {
    expect(isOnEngineCorner(W / 2, H / 2, W, H, W, 'portrait')).toBe(false);
    expect(isOnEngineCorner(W - 10, H / 2, W, H, W, 'portrait')).toBe(false); // right edge midpoint
  });
});

describe('gallery defaults per viewport', () => {
  it('collapsed on phone portrait, visible on iPad portrait and desktop', () => {
    expect(galleryDefaultVisible(390, 844)).toBe(false); // iPhone 13
    expect(galleryDefaultVisible(768, 1024)).toBe(true); // iPad portrait
    expect(galleryDefaultVisible(1280, 800)).toBe(true); // desktop
  });

  it('collapsed in extreme landscape (short and very wide)', () => {
    expect(galleryDefaultVisible(844, 390)).toBe(false); // phone landscape, aspect > 2
    expect(galleryDefaultVisible(900, 500)).toBe(true); // tall enough
  });

  it('phone portrait detection drives the overlay mode', () => {
    expect(isPhonePortraitViewport(390, 844)).toBe(true);
    expect(isPhonePortraitViewport(768, 1024)).toBe(false);
    expect(isPhonePortraitViewport(844, 390)).toBe(false);
  });
});
