import { describe, it, expect } from 'vitest';
import { parseSheetValidationVerdict } from './avatar-renditions.helpers.js';

/**
 * The avatar sheet validator returns a strict JSON verdict
 * (SHEET_VALIDATION_RESPONSE_SCHEMA): four axis booleans + passed + notes.
 * This helper turns that raw text into a log-shaped verdict so the failure
 * log can name which rubric axes failed and carry the validator's notes.
 */
describe('parseSheetValidationVerdict', () => {
  const passing = JSON.stringify({
    sameCharacter: true,
    allPanelsConsistent: true,
    styleMatches: true,
    noTextArtifacts: true,
    passed: true,
    notes: 'Looks great.',
  });

  it('surfaces the clothing report fields when present (X15 safety)', () => {
    const withClothing = JSON.stringify({
      sameCharacter: true,
      allPanelsConsistent: true,
      styleMatches: true,
      noTextArtifacts: true,
      passed: true,
      notes: 'Looks great.',
      clothingMatchesDescription: false,
      observedClothing: 'orange raglan tee with white sleeves',
    });
    const v = parseSheetValidationVerdict(withClothing);
    expect(v.passed).toBe(true);
    expect(v.clothingMatchesDescription).toBe(false);
    expect(v.observedClothing).toBe('orange raglan tee with white sleeves');
  });

  it('clothing report is NEVER a pass/fail axis: mismatch does not fail the sheet or join failedAxes', () => {
    const v = parseSheetValidationVerdict(
      JSON.stringify({
        sameCharacter: true,
        allPanelsConsistent: true,
        styleMatches: true,
        noTextArtifacts: true,
        passed: true,
        notes: '',
        clothingMatchesDescription: false,
        observedClothing: 'orange tee',
      }),
    );
    expect(v.passed).toBe(true);
    expect(v.failedAxes).toEqual([]);
  });

  it('tolerates verdicts without the clothing fields (nulls, pre-X15 shape)', () => {
    const v = parseSheetValidationVerdict(passing);
    expect(v.clothingMatchesDescription).toBeNull();
    expect(v.observedClothing).toBeNull();
  });

  it('reports a clean pass with no failed axes', () => {
    expect(parseSheetValidationVerdict(passing)).toEqual({
      passed: true,
      failedAxes: [],
      notes: 'Looks great.',
      clothingMatchesDescription: null,
      observedClothing: null,
    });
  });

  it('names the single failed axis and keeps the notes', () => {
    const text = JSON.stringify({
      sameCharacter: true,
      allPanelsConsistent: true,
      styleMatches: false,
      noTextArtifacts: true,
      passed: false,
      notes: 'Palette drifted from the style bible.',
    });
    expect(parseSheetValidationVerdict(text)).toEqual({
      passed: false,
      failedAxes: ['styleMatches'],
      notes: 'Palette drifted from the style bible.',
      clothingMatchesDescription: null,
      observedClothing: null,
    });
  });

  it('names every failed axis in schema order', () => {
    const text = JSON.stringify({
      sameCharacter: false,
      allPanelsConsistent: true,
      styleMatches: false,
      noTextArtifacts: false,
      passed: false,
      notes: 'Multiple issues.',
    });
    expect(parseSheetValidationVerdict(text).failedAxes).toEqual([
      'sameCharacter',
      'styleMatches',
      'noTextArtifacts',
    ]);
  });

  it('surfaces a holistic fail (passed false, all axes true) via the notes', () => {
    const text = JSON.stringify({
      sameCharacter: true,
      allPanelsConsistent: true,
      styleMatches: true,
      noTextArtifacts: true,
      passed: false,
      notes: 'Humanoid action figure reads as a real person — off-rubric.',
    });
    expect(parseSheetValidationVerdict(text)).toEqual({
      passed: false,
      failedAxes: [],
      notes: 'Humanoid action figure reads as a real person — off-rubric.',
      clothingMatchesDescription: null,
      observedClothing: null,
    });
  });

  it('treats unparseable text as a closed fail and carries the raw text', () => {
    expect(parseSheetValidationVerdict('not json at all')).toEqual({
      passed: false,
      failedAxes: ['unparseable'],
      notes: 'not json at all',
      clothingMatchesDescription: null,
      observedClothing: null,
    });
  });

  it('treats empty text as a closed fail with empty notes', () => {
    expect(parseSheetValidationVerdict('')).toEqual({
      passed: false,
      failedAxes: ['unparseable'],
      notes: '',
      clothingMatchesDescription: null,
      observedClothing: null,
    });
  });

  it('treats non-object JSON as unparseable', () => {
    expect(parseSheetValidationVerdict('true')).toEqual({
      passed: false,
      failedAxes: ['unparseable'],
      notes: 'true',
      clothingMatchesDescription: null,
      observedClothing: null,
    });
  });

  it('truncates the raw text of an unparseable verdict to 300 chars', () => {
    const long = 'x'.repeat(500);
    const result = parseSheetValidationVerdict(long);
    expect(result.notes).toHaveLength(300);
    expect(result.failedAxes).toEqual(['unparseable']);
  });

  it('defaults missing notes to an empty string', () => {
    const text = JSON.stringify({
      sameCharacter: true,
      allPanelsConsistent: true,
      styleMatches: true,
      noTextArtifacts: true,
      passed: true,
    });
    expect(parseSheetValidationVerdict(text).notes).toBe('');
  });
});
