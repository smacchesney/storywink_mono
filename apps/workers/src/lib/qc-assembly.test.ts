import { describe, it, expect } from 'vitest';
import type { CharacterIdentity } from '@storywink/shared/types';
import {
  expectedCastForPage,
  heldPropsForPage,
  pageFeedFor,
  assembleQcBatchParts,
  type QcAssemblyPage,
} from './qc-assembly.js';

const identity: CharacterIdentity = {
  characters: [
    {
      characterId: 'child_1',
      role: 'main_child',
      name: 'Kai',
      physicalTraits: {
        apparentAge: '6',
        hairColor: 'black',
        hairStyle: 'short',
        skinTone: 'golden-brown',
        bodyBuild: 'small',
        distinguishingFeatures: ['freckles'],
      },
      typicalClothing: 'red raincoat',
      styleTranslation: 'soft crayon',
      appearsOnPages: [1, 2, 3],
    },
    {
      characterId: 'toy_1',
      role: 'companion_object',
      name: 'Grypho',
      species: 'green toy crocodile',
      physicalTraits: {
        apparentAge: 'n/a',
        hairColor: 'none',
        hairStyle: 'none',
        skinTone: 'green',
        bodyBuild: 'plush',
        distinguishingFeatures: ['crocodile snout'],
      },
      typicalClothing: 'none',
      styleTranslation: 'plush',
      appearsOnPages: [2],
    },
  ],
  sceneContext: 'rainy day',
};

function page(n: number, overrides: Partial<QcAssemblyPage> = {}): QcAssemblyPage {
  return {
    pageNumber: n,
    pageId: `page-${n}`,
    generatedImageUrl: `https://res.cloudinary.com/demo/image/upload/page_${n}.png`,
    source: 'PHOTO',
    text: `Text of page ${n}.`,
    bridgeScene: null,
    ...overrides,
  };
}

describe('expectedCastForPage', () => {
  it('always includes the main character; others only on their pages', () => {
    expect(expectedCastForPage(identity, page(2)).map((c) => c.name)).toEqual(['Kai', 'Grypho']);
    // Page 3: Grypho does not appear.
    expect(expectedCastForPage(identity, page(3)).map((c) => c.name)).toEqual(['Kai']);
  });

  it('uses the SAME species phrasing the render prompt feeds (speciesLineFor)', () => {
    const cast = expectedCastForPage(identity, page(2));
    expect(cast).toEqual([
      { name: 'Kai', species: 'a person' },
      { name: 'Grypho', species: 'a green toy crocodile' },
    ]);
  });

  it('bridge pages honor the story-authored scene cast', () => {
    const bridge = page(5, {
      source: 'BRIDGE',
      bridgeScene: { charactersPresent: ['toy_1'], props: [] },
    });
    expect(expectedCastForPage(identity, bridge).map((c) => c.name)).toEqual(['Grypho']);
  });

  it('falls back to the photo-page filter when bridge ids resolve to nothing', () => {
    const bridge = page(2, {
      source: 'BRIDGE',
      bridgeScene: { charactersPresent: ['stale_id'], props: [] },
    });
    expect(expectedCastForPage(identity, bridge).map((c) => c.name)).toEqual(['Kai', 'Grypho']);
  });

  it('returns empty for a null identity', () => {
    expect(expectedCastForPage(null, page(1))).toEqual([]);
  });
});

describe('heldPropsForPage', () => {
  it('keeps only props whose text names a holder', () => {
    const p = page(1, {
      bridgeScene: { props: ['lantern held by Kai', 'red umbrella', 'Grypho holding a map'] },
    });
    expect(heldPropsForPage(p)).toEqual(['lantern held by Kai', 'Grypho holding a map']);
  });

  it('is empty for missing scenes, non-array props, and holder-less props', () => {
    expect(heldPropsForPage(page(1, { bridgeScene: null }))).toEqual([]);
    expect(heldPropsForPage(page(1, { bridgeScene: { props: 'oops' } }))).toEqual([]);
    expect(heldPropsForPage(page(1, { bridgeScene: { props: ['red umbrella'] } }))).toEqual([]);
  });
});

describe('pageFeedFor', () => {
  it('bundles text, cast, and held props — the exact judge feed the telemetry mirrors', () => {
    const p = page(2, { bridgeScene: { props: ['lantern held by Kai'] } });
    expect(pageFeedFor(identity, p)).toEqual({
      text: 'Text of page 2.',
      cast: [
        { name: 'Kai', species: 'a person' },
        { name: 'Grypho', species: 'a green toy crocodile' },
      ],
      props: ['lantern held by Kai'],
    });
  });

  it('nulls missing text', () => {
    expect(pageFeedFor(identity, page(1, { text: undefined })).text).toBe(null);
  });
});

describe('assembleQcBatchParts (the assembled level)', () => {
  // A SECOND batch of a book (pages 7-10): the seam the ordinal-restart
  // guarantees protect.
  const batch2 = [page(7), page(8, { source: 'BRIDGE' }), page(9), page(10)];
  const assembly = assembleQcBatchParts({
    batch: batch2,
    characterIdentity: identity,
    language: 'en',
    sheetCount: 1,
  });

  it('restarts PAGE-n ordinals at 1 for every batch', () => {
    const labels = assembly.contentParts
      .filter((p): p is { type: 'input_text'; text: string } => p.type === 'input_text')
      .map((p) => p.text)
      .filter((t) => t.startsWith('PAGE '));
    expect(labels).toEqual(['PAGE 1', 'PAGE 2', 'PAGE 3', 'PAGE 4']);
  });

  it('tells the judge the batch-local pageCount, not the book-wide one', () => {
    expect(assembly.promptText).toContain('Evaluate these 4');
    expect(assembly.promptText).toContain('page 1 through page 4');
  });

  it('maps each batch-local ordinal back to the right DB page', () => {
    expect(assembly.pageMapping).toEqual([
      { pageNumber: 7, pageId: 'page-7' },
      { pageNumber: 8, pageId: 'page-8' },
      { pageNumber: 9, pageId: 'page-9' },
      { pageNumber: 10, pageId: 'page-10' },
    ]);
  });

  it('interleaves label → image in send order, ending with the prompt', () => {
    const kinds = assembly.contentParts.map((p) => p.type);
    expect(kinds).toEqual([
      'input_text',
      'input_image',
      'input_text',
      'input_image',
      'input_text',
      'input_image',
      'input_text',
      'input_image',
      'input_text', // the rubric prompt
    ]);
    const last = assembly.contentParts[assembly.contentParts.length - 1];
    expect(last).toEqual({ type: 'input_text', text: assembly.promptText });
  });

  it("feeds each ordinal ITS page's context (batch-local alignment)", () => {
    expect(assembly.pageContext.map((c) => c.ordinal)).toEqual([1, 2, 3, 4]);
    expect(assembly.pageContext[0].text).toBe('Text of page 7.');
    expect(assembly.promptText).toContain('PAGE 1 — Expected cast:');
    expect(assembly.promptText).toContain('"Text of page 7."');
    expect(assembly.promptText).toContain('"Text of page 10."');
    // Book-wide page numbers must never leak into the feed labels.
    expect(assembly.promptText).not.toContain('PAGE 7 —');
  });

  it('reports BRIDGE pages by their batch-local ordinal', () => {
    expect(assembly.bridgePageOrdinals).toEqual([2]);
    expect(assembly.promptText).toContain('PAGE 2 was');
    expect(assembly.promptText).toContain('generated WITHOUT a source photo');
  });

  it('sends each page image vision-optimized', () => {
    const images = assembly.contentParts.filter(
      (p): p is { type: 'input_image'; image_url: string; detail: 'high' } =>
        p.type === 'input_image',
    );
    expect(images).toHaveLength(4);
    expect(images[0].image_url).toContain('page_7.png');
    expect(images.every((i) => i.detail === 'high')).toBe(true);
  });

  it('throws on a page with no render rather than shifting later ordinals', () => {
    expect(() =>
      assembleQcBatchParts({
        batch: [page(1), page(2, { generatedImageUrl: null })],
        characterIdentity: identity,
        language: 'en',
        sheetCount: 0,
      }),
    ).toThrow(/page 2 .* no generatedImageUrl/);
  });
});
