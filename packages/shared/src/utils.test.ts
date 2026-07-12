import { describe, it, expect } from 'vitest';
import {
  isTitlePage,
  categorizePages,
  calculatePrintedPageCount,
  convertHeicToJpeg,
} from './utils.js';

describe('isTitlePage', () => {
  it('is true when the page asset matches the cover asset', () => {
    expect(isTitlePage('asset-1', 'asset-1')).toBe(true);
  });

  it('is false when the assets differ', () => {
    expect(isTitlePage('asset-1', 'asset-2')).toBe(false);
  });

  it('is false when the cover asset is null', () => {
    expect(isTitlePage('asset-1', null)).toBe(false);
  });

  it('is false when the page asset is null (even if cover is also null)', () => {
    // Guards against null === null being treated as a match.
    expect(isTitlePage(null, null)).toBe(false);
    expect(isTitlePage(null, 'asset-1')).toBe(false);
  });
});

describe('categorizePages', () => {
  it('splits cover pages out while keeping every page as a story page', () => {
    const pages = [{ assetId: 'cover-1' }, { assetId: 'a2' }, { assetId: 'a3' }];
    const { storyPages, coverPages } = categorizePages(pages, 'cover-1');

    // storyPages includes ALL pages (the cover photo participates in the story).
    expect(storyPages).toHaveLength(3);
    expect(storyPages).toEqual(pages);

    // coverPages identifies only the page whose asset matches the cover.
    expect(coverPages).toHaveLength(1);
    expect(coverPages[0].assetId).toBe('cover-1');
  });

  it('returns no cover pages when nothing matches the cover asset', () => {
    const pages = [{ assetId: 'a1' }, { assetId: 'a2' }];
    const { storyPages, coverPages } = categorizePages(pages, 'missing');
    expect(storyPages).toHaveLength(2);
    expect(coverPages).toHaveLength(0);
  });

  it('returns no cover pages when the cover asset is null', () => {
    const pages = [{ assetId: 'a1' }, { assetId: null }];
    const { coverPages } = categorizePages(pages, null);
    expect(coverPages).toHaveLength(0);
  });
});

describe('calculatePrintedPageCount', () => {
  // Lulu formula (interior): 2 (dedication + ending) + 2N story photos,
  // optionally padded to the next multiple of 4 for saddle stitch.
  it('computes the raw interior count without padding', () => {
    expect(calculatePrintedPageCount(10)).toBe(2 + 2 * 10); // 22
    expect(calculatePrintedPageCount(0)).toBe(2);
    expect(calculatePrintedPageCount(1)).toBe(4);
  });

  it('pads up to the next multiple of 4 when requested', () => {
    // N=10 -> raw 22 -> padded 24
    expect(calculatePrintedPageCount(10, { padToMultipleOf4: true })).toBe(24);
    // N=6 -> raw 14 -> padded 16
    expect(calculatePrintedPageCount(6, { padToMultipleOf4: true })).toBe(16);
    // N=1 -> raw 4 -> already a multiple of 4
    expect(calculatePrintedPageCount(1, { padToMultipleOf4: true })).toBe(4);
    // N=3 -> raw 8 -> already a multiple of 4
    expect(calculatePrintedPageCount(3, { padToMultipleOf4: true })).toBe(8);
  });
});

describe('convertHeicToJpeg', () => {
  const base = 'https://res.cloudinary.com/storywink/image/upload/v1/user_x/photo';

  it('rewrites .heic URLs with an f_jpg transform', () => {
    expect(convertHeicToJpeg(`${base}.heic`)).toBe(
      'https://res.cloudinary.com/storywink/image/upload/f_jpg,fl_force_strip/v1/user_x/photo.heic',
    );
  });

  it('rewrites .heif URLs with an f_jpg transform', () => {
    expect(convertHeicToJpeg(`${base}.heif`)).toBe(
      'https://res.cloudinary.com/storywink/image/upload/f_jpg,fl_force_strip/v1/user_x/photo.heif',
    );
  });

  it('is case-insensitive on the extension', () => {
    expect(convertHeicToJpeg(`${base}.HEIC`)).toContain('f_jpg,fl_force_strip');
  });

  it('passes non-HEIC URLs through unchanged', () => {
    expect(convertHeicToJpeg(`${base}.jpg`)).toBe(`${base}.jpg`);
  });

  it('returns an empty string for null/undefined', () => {
    expect(convertHeicToJpeg(null)).toBe('');
    expect(convertHeicToJpeg(undefined)).toBe('');
  });
});
