import { describe, it, expect } from 'vitest';
import { createQCPrompt, QC_RESPONSE_SCHEMA } from './quality-check.js';

describe('createQCPrompt (baseline, no sheets or cover)', () => {
  const prompt = createQCPrompt(null, 8);

  it('keeps the page-ordinal labeling contract', () => {
    expect(prompt).toContain('page 1 through page 8');
    expect(prompt).toContain('"PAGE n"');
  });

  it('mentions neither reference sheets nor the cover', () => {
    expect(prompt).not.toContain('REFERENCE SHEET');
    expect(prompt).not.toContain('COVER RUBRIC');
  });
});

describe('createQCPrompt with character sheets', () => {
  const prompt = createQCPrompt(null, 8, 'en', { sheetCount: 2 });

  it('declares the sheets as ground truth with a non-numeric label', () => {
    expect(prompt).toContain('REFERENCE SHEET');
    expect(prompt).toContain('GROUND TRUTH');
  });

  it('excludes the sheets from pageResults', () => {
    expect(prompt).toContain('do NOT include them in "pageResults"');
  });
});

describe('createQCPrompt cover rubric variant', () => {
  const prompt = createQCPrompt(null, 8, 'en', {
    sheetCount: 1,
    cover: { expectedTitle: "Mia's Rainy Day" },
  });

  it('labels the cover with a non-numeric label and routes it to coverResult', () => {
    expect(prompt).toContain('labeled "COVER"');
    expect(prompt).toContain('"coverResult"');
    expect(prompt).toContain('NOT in "pageResults"');
  });

  it('expects the painted title and requires an exact match against the book title', () => {
    expect(prompt).toContain('EXPECTED');
    expect(prompt).toContain(`EXACTLY "Mia's Rainy Day"`);
    expect(prompt).toContain('titleMatches=false');
  });

  it('exempts a correct title from the stray-text cap', () => {
    expect(prompt).toContain('must NOT count as stray text');
    expect(prompt).toContain('must NOT cap the overall score');
  });

  it('still caps other unintended text on the cover', () => {
    expect(prompt).toContain('caps OVERALL QUALITY at 4');
  });

  it('scores cover characters against the reference sheet when sheets are present', () => {
    expect(prompt).toContain('against the REFERENCE SHEET');
  });
});

describe('QC_RESPONSE_SCHEMA coverResult extension', () => {
  it('keeps strict-mode invariants (all properties required, no additionals)', () => {
    expect(QC_RESPONSE_SCHEMA.required).toContain('coverResult');
    expect(QC_RESPONSE_SCHEMA.additionalProperties).toBe(false);
    const cover = QC_RESPONSE_SCHEMA.properties.coverResult;
    expect(cover.type).toEqual(['object', 'null']);
    expect(cover.required).toEqual(Object.keys(cover.properties));
    expect(cover.additionalProperties).toBe(false);
  });

  it('cover result carries the title-match verdict', () => {
    expect(QC_RESPONSE_SCHEMA.properties.coverResult.properties.titleMatches).toEqual({
      type: 'boolean',
    });
  });
});

describe('createQCPrompt bridge-page lines', () => {
  it('is absent when no bridge ordinals are passed (flag-off / photo-only books)', () => {
    const prompt = createQCPrompt(null, 8, 'en', {});
    expect(prompt).not.toContain('WITHOUT a source photo');
    expect(prompt).not.toContain('near-duplicate');
  });

  it('names the bridge pages by their PAGE-n presentation ordinals', () => {
    const prompt = createQCPrompt(null, 8, 'en', { bridgePageOrdinals: [3, 7] });
    expect(prompt).toContain('PAGE 3, PAGE 7');
    expect(prompt).toContain('generated WITHOUT a source photo');
  });

  it('adds the strict-consistency and near-duplicate-composition instructions', () => {
    const prompt = createQCPrompt(null, 8, 'en', { bridgePageOrdinals: [3], sheetCount: 1 });
    expect(prompt).toContain('STRICTLY against the canonical description and the REFERENCE SHEET');
    expect(prompt).toContain('near-duplicate of a neighboring page');
  });
});
