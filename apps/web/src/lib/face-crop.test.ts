import { describe, it, expect } from 'vitest';
import { faceCropUrl, faceThumbUrl, paddedFaceBox, FACE_CROP_RENDERED_PX } from './face-crop';

const SRC = 'https://res.cloudinary.com/demo/image/upload/v123/storywink/abc.jpg';

describe('paddedFaceBox', () => {
  it('pads 40% each side and clamps to [0,1]', () => {
    expect(paddedFaceBox({ pageNumber: 1, x: 0.4, y: 0.2, w: 0.2, h: 0.2 })).toEqual({
      x: 0.32,
      y: 0.12,
      w: 0.36,
      h: 0.36,
    });
  });
  it('clamps at the frame edges', () => {
    const b = paddedFaceBox({ pageNumber: 1, x: 0, y: 0.9, w: 0.2, h: 0.2 });
    expect(b.x).toBe(0);
    expect(b.y + b.h).toBeLessThanOrEqual(1);
  });
});

describe('faceCropUrl', () => {
  it('builds relative c_crop then c_fill at 2x DPR, rounded to 4 decimals', () => {
    const url = faceCropUrl(SRC, { pageNumber: 1, x: 0.4, y: 0.2, w: 0.2, h: 0.2 });
    expect(url).toBe(
      `https://res.cloudinary.com/demo/image/upload/c_crop,x_0.32,y_0.12,w_0.36,h_0.36/c_fill,w_${FACE_CROP_RENDERED_PX * 2},h_${FACE_CROP_RENDERED_PX * 2},g_auto,f_auto,q_auto/v123/storywink/abc.jpg`,
    );
  });
  it('degenerate boxes (w or h <= 0) fall back to the g_face thumb', () => {
    expect(faceCropUrl(SRC, { pageNumber: 1, x: 0.5, y: 0.5, w: 0, h: 0.1 })).toBe(
      faceThumbUrl(SRC),
    );
  });
  it('null box falls back to the g_face thumb', () => {
    expect(faceCropUrl(SRC, null)).toBe(faceThumbUrl(SRC));
  });
  it('non-Cloudinary URLs pass through untouched', () => {
    expect(faceCropUrl('https://other.host/x.jpg', null)).toBe('https://other.host/x.jpg');
  });
});
