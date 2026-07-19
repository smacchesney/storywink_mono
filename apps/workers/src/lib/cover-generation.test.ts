import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IllustrationInput } from './illustrators/types.js';

// --- Heavy-dependency mocks: this suite verifies ONLY the reference-stack
// ordering and the composition-brief threading, so every side effect
// (cloudinary upload, prisma write, image processing, provider render) is
// stubbed. The prompt assembler (@storywink/shared) runs for real so the
// "first N images" claim is checked against the true prompt text. ---

const generateMock = vi.hoisted(() => vi.fn());
vi.mock('./illustrators/index.js', () => ({
  getIllustrator: () => ({
    name: 'gemini' as const,
    modelId: 'gemini-3.1-flash-image-preview',
    generate: generateMock,
  }),
}));

vi.mock('./images.js', () => ({
  fetchImageInput: vi.fn(async () => ({ buffer: Buffer.from('style'), mimeType: 'image/png' })),
}));

vi.mock('../utils/image-processing.js', () => ({
  addLogoToTitlePage: vi.fn(async (b: Buffer) => b),
  upscaleForPrint: vi.fn(async (b: Buffer) => b),
}));

vi.mock('../database/index.js', () => ({
  default: { book: { update: vi.fn(async () => ({})) } },
}));

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload_stream: vi.fn((_opts: unknown, cb: (e: unknown, r: unknown) => void) => ({
        end: () => cb(null, { secure_url: 'https://res.cloudinary.com/x/cover.png' }),
      })),
    },
  },
}));

import { generateAndStoreCover, CoverGenerationOptions } from './cover-generation.js';

const img = (tag: string) => ({ buffer: Buffer.from(tag), mimeType: 'image/png' });

const baseOpts = (): CoverGenerationOptions => ({
  bookId: 'book_1',
  styleKey: 'vignette',
  bookTitle: 'Splash Day',
  pageText: 'a splashy beach day',
  illustrationNotes: null,
  language: 'en',
  characterIdentity: null,
  pageNumber: 1,
  contentImage: img('hero1'),
  characterSheetRefs: [],
  interiorRenderRef: null,
  qcFeedback: null,
  // pino Logger stub
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
});

const lastGenerateInput = (): IllustrationInput =>
  generateMock.mock.calls[0][0] as IllustrationInput;

describe('generateAndStoreCover — hero refs + composition threading (X17 A1)', () => {
  beforeEach(() => {
    generateMock.mockReset();
    generateMock.mockResolvedValue({ imageBase64: Buffer.from('cover').toString('base64') });
  });

  it('extraHeroRefs LEAD characterRefs, then sheets, then the interior render', async () => {
    const extra = [img('hero2'), img('hero3')];
    const sheets = [img('sheetA'), img('sheetB')];
    const interior = img('interior');

    await generateAndStoreCover({
      ...baseOpts(),
      characterSheetRefs: sheets,
      interiorRenderRef: interior,
      extraHeroRefs: extra,
      coverComposition: { themeLine: 'a splashy beach day with Grandma', heroPhotoCount: 3 },
    });

    expect(lastGenerateInput().characterRefs).toEqual([...extra, ...sheets, interior]);
  });

  it('clamps heroPhotoCount to the ACTUAL hero-image count (contentImage + extraHeroRefs), ignoring the raw caller value', async () => {
    // Caller lies with 99; real hero images = 1 contentImage + 1 extra = 2.
    await generateAndStoreCover({
      ...baseOpts(),
      extraHeroRefs: [img('hero2')],
      coverComposition: { themeLine: 'a beach day', heroPhotoCount: 99 },
    });

    const prompt = lastGenerateInput().prompt;
    expect(prompt).toContain('the first 2 images are real photos');
    expect(prompt).not.toContain('first 99');
  });

  it('with no extraHeroRefs, heroPhotoCount clamps to 1 (contentImage only)', async () => {
    await generateAndStoreCover({
      ...baseOpts(),
      coverComposition: { themeLine: null, heroPhotoCount: 5 },
    });

    expect(lastGenerateInput().prompt).toContain('the first 1 image is a real photo');
  });

  it('legacy path (absent extraHeroRefs + coverComposition) is byte-identical: no leading hero refs, no COVER COMPOSITION brief', async () => {
    const sheets = [img('sheetA')];
    const interior = img('interior');

    await generateAndStoreCover({
      ...baseOpts(),
      characterSheetRefs: sheets,
      interiorRenderRef: interior,
    });

    const input = lastGenerateInput();
    expect(input.characterRefs).toEqual([...sheets, interior]);
    expect(input.prompt).not.toContain('COVER COMPOSITION');
  });
});
