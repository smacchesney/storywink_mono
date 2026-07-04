import { describe, it, expect } from 'vitest';
import { computeBookStatus, type StatusPage } from './computeBookStatus.js';

/** Build a page with sensible defaults; override only what a case cares about. */
function page(overrides: Partial<StatusPage> = {}): StatusPage {
  return {
    text: 'Once upon a time.',
    generatedImageUrl: 'https://cdn.example/img.png',
    assetId: 'asset-default',
    ...overrides,
  };
}

describe('computeBookStatus', () => {
  it('returns COMPLETED when every page has text and an illustration', () => {
    const pages = [
      page({ assetId: 'a1' }),
      page({ assetId: 'a2' }),
      page({ assetId: 'a3' }),
    ];
    expect(computeBookStatus(pages, 'a1')).toBe('COMPLETED');
  });

  it('returns COMPLETED when all illustrations exist but some text is missing (all-illustrations short-circuit)', () => {
    const pages = [
      page({ assetId: 'a1', text: 'Page one.' }),
      page({ assetId: 'a2', text: null }), // missing text, still illustrated
      page({ assetId: 'a3', text: '   ' }), // whitespace-only text counts as missing
    ];
    expect(computeBookStatus(pages, 'a1')).toBe('COMPLETED');
  });

  it('returns PARTIAL when some pages have text but no illustrations exist', () => {
    const pages = [
      page({ assetId: 'a1', text: 'Page one.', generatedImageUrl: null }),
      page({ assetId: 'a2', text: 'Page two.', generatedImageUrl: null }),
    ];
    expect(computeBookStatus(pages, 'a1')).toBe('PARTIAL');
  });

  it('returns PARTIAL when some pages are illustrated but not all (and not everything)', () => {
    const pages = [
      page({ assetId: 'a1', text: 'Page one.', generatedImageUrl: 'https://cdn/1.png' }),
      page({ assetId: 'a2', text: null, generatedImageUrl: null }),
    ];
    // illustrationsComplete = false (1 of 2), but at least one illustration exists.
    expect(computeBookStatus(pages, 'a1')).toBe('PARTIAL');
  });

  it('returns FAILED when nothing has been generated (no text, no illustrations)', () => {
    const pages = [
      page({ assetId: 'a1', text: null, generatedImageUrl: null }),
      page({ assetId: 'a2', text: '', generatedImageUrl: null }),
    ];
    expect(computeBookStatus(pages, 'a1')).toBe('FAILED');
  });

  it('reaches COMPLETED even when the cover page has no text, because all pages are illustrated', () => {
    // The cover page (assetId === coverAssetId) carries no story text but IS
    // illustrated; every other (story) page is fully texted + illustrated.
    // Current semantics: categorizePages returns ALL pages as storyPages, so
    // textComplete is false (cover has no text) — but illustrationsComplete is
    // true, so the all-illustrations short-circuit yields COMPLETED.
    const pages = [
      page({ assetId: 'cover-1', text: null }), // cover page, illustrated, no text
      page({ assetId: 'a2', text: 'Page two.' }),
      page({ assetId: 'a3', text: 'Page three.' }),
    ];
    expect(computeBookStatus(pages, 'cover-1')).toBe('COMPLETED');
  });
});
