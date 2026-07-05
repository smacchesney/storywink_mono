import { describe, it, expect } from 'vitest';
import {
  STYLE_LIBRARY,
  getAllStyleKeys,
  getStyleBible,
  PEOPLE_SOURCE_HIERARCHY,
} from './styles.js';

const ctx = {
  bookTitle: 'The Puddle Jump',
  pageText: 'Mia jumped right in.',
  illustrationNotes: null,
  referenceImageCount: 2,
  language: 'en',
};

describe('style bible freezing', () => {
  for (const styleKey of getAllStyleKeys()) {
    const style = STYLE_LIBRARY[styleKey];
    const bible = getStyleBible(styleKey);

    it(`${styleKey}: interior and cover embed the byte-identical bible block`, () => {
      expect(bible.length).toBeGreaterThan(100);
      expect(style.buildInteriorPrompt(ctx)).toContain(bible);
      expect(style.buildCoverPrompt(ctx)).toContain(bible);
    });

    it(`${styleKey}: interior and cover embed the shared source hierarchy verbatim`, () => {
      expect(style.buildInteriorPrompt(ctx)).toContain(PEOPLE_SOURCE_HIERARCHY);
      expect(style.buildCoverPrompt(ctx)).toContain(PEOPLE_SOURCE_HIERARCHY);
    });

    it(`${styleKey}: prompts no longer carry the old photo-fidelity block that fought the identity override`, () => {
      expect(style.buildInteriorPrompt(ctx)).not.toContain('PEOPLE - STRICT FIDELITY');
      expect(style.buildCoverPrompt(ctx)).not.toContain('PEOPLE - STRICT FIDELITY');
    });
  }
});

describe('PEOPLE_SOURCE_HIERARCHY arbitration content', () => {
  it('gives identity features to the character reference', () => {
    expect(PEOPLE_SOURCE_HIERARCHY).toContain('CHARACTER IDENTITY reference wins');
  });

  it("gives pose, clothing, and composition to the page's photo", () => {
    expect(PEOPLE_SOURCE_HIERARCHY).toMatch(/pose, body position, expression, clothing/);
    expect(PEOPLE_SOURCE_HIERARCHY).toContain('follow the photo exactly');
  });

  it('keeps the never-invent rule for photo-only books', () => {
    expect(PEOPLE_SOURCE_HIERARCHY).toContain('never invent');
    expect(PEOPLE_SOURCE_HIERARCHY).toContain('match every feature to the photo');
  });
});

describe('cover prompts keep their title treatment', () => {
  for (const styleKey of getAllStyleKeys()) {
    it(`${styleKey}: cover prompt paints the book title`, () => {
      expect(STYLE_LIBRARY[styleKey].buildCoverPrompt(ctx)).toContain('The Puddle Jump');
    });
  }
});
