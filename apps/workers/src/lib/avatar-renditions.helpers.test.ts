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

  it('reports a clean pass with no failed axes', () => {
    expect(parseSheetValidationVerdict(passing)).toEqual({
      passed: true,
      failedAxes: [],
      notes: 'Looks great.',
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
    });
  });

  it('treats unparseable text as a closed fail and carries the raw text', () => {
    expect(parseSheetValidationVerdict('not json at all')).toEqual({
      passed: false,
      failedAxes: ['unparseable'],
      notes: 'not json at all',
    });
  });

  it('treats empty text as a closed fail with empty notes', () => {
    expect(parseSheetValidationVerdict('')).toEqual({
      passed: false,
      failedAxes: ['unparseable'],
      notes: '',
    });
  });

  it('treats non-object JSON as unparseable', () => {
    expect(parseSheetValidationVerdict('true')).toEqual({
      passed: false,
      failedAxes: ['unparseable'],
      notes: 'true',
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
