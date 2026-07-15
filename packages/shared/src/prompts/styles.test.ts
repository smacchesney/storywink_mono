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

describe('interiors no longer instruct rendered onomatopoeia text', () => {
  const ctxWithNotes = { ...ctx, illustrationNotes: 'splashing through a puddle' };
  for (const styleKey of getAllStyleKeys()) {
    it(`${styleKey}: DYNAMIC EFFECTS drops the lettering instruction but keeps the effects block`, () => {
      const interior = STYLE_LIBRARY[styleKey].buildInteriorPrompt(ctxWithNotes);
      expect(interior).not.toContain('Draw onomatopoeia text');
      expect(interior).not.toContain('onomatopoeia');
      expect(interior).toContain('DYNAMIC EFFECTS: Add visual effects to enhance the action.');
      expect(interior).toContain('under 15% of image area');
      expect(interior).toContain('Specific effect to add: splashing through a puddle');
      // the interior no-text sentence moved to the assembler-level rule
      expect(interior).not.toContain('DO NOT add any text to the image');
    });

    it(`${styleKey}: the effect note is bound to a visual-only rendering`, () => {
      const interior = STYLE_LIBRARY[styleKey].buildInteriorPrompt(ctxWithNotes);
      expect(interior).toContain(
        '— expressed purely as a visual effect; if the note names a sound or word, depict its energy with motion or particles, never letters.',
      );
    });
  }
});

describe('cover prompts forbid duplicate characters', () => {
  for (const styleKey of getAllStyleKeys()) {
    it(`${styleKey}: cover carries the exactly-once cast rule`, () => {
      expect(STYLE_LIBRARY[styleKey].buildCoverPrompt(ctx)).toContain(
        'Each character appears exactly once — never draw the same character twice.',
      );
    });
  }
});

describe('cover title isolation (no leaked color name)', () => {
  for (const styleKey of getAllStyleKeys()) {
    it(`${styleKey}: cover frames the title as a literal, uses hex-only color, no capitalized color name`, () => {
      const cover = STYLE_LIBRARY[styleKey].buildCoverPrompt(ctx);
      expect(cover).not.toContain('Coral');
      expect(cover).toContain('#F76C5E');
      expect(cover).toContain('Render this exact title text and nothing more:');
      expect(cover).toContain('The ONLY text in the image is the title above');
    });
  }
});
