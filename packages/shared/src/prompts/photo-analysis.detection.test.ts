import { describe, it, expect } from 'vitest';
import {
  createSubjectDetectionPrompt,
  SUBJECT_DETECTION_RESPONSE_SCHEMA,
  SUBJECT_DETECTION_SYSTEM_PROMPT,
  MAX_BATCH_PHOTOS,
  MAX_BATCH_SUBJECTS,
} from './photo-analysis.js';

describe('batch caps', () => {
  it('are the tunable constants the owner set (10 photos / 6 subjects)', () => {
    expect(MAX_BATCH_PHOTOS).toBe(10);
    expect(MAX_BATCH_SUBJECTS).toBe(6);
  });
});

describe('createSubjectDetectionPrompt', () => {
  const prompt = createSubjectDetectionPrompt({ photoCount: 8 });

  it('is roster-only: no story fields leak in from the perception prompt', () => {
    expect(prompt).not.toMatch(/eventSummary/);
    expect(prompt).not.toMatch(/suggestedTitle/);
    expect(prompt).not.toMatch(/captureQuestions/);
    expect(prompt).not.toMatch(/narrativeRole/);
  });

  it('names the photo count and the subject cap', () => {
    expect(prompt).toContain('8 photos');
    expect(prompt).toContain(`${MAX_BATCH_SUBJECTS}`);
  });

  it('demands a recognizable parentDescription and a label that is never a name', () => {
    expect(prompt).toMatch(/parentDescription/);
    expect(prompt).toMatch(/defaultLabel/);
    expect(prompt).toMatch(/never invent a (proper |personal )?name/i);
  });

  it('writes styleTranslation for the vignette baseline', () => {
    expect(prompt).toMatch(/vignette/);
  });

  it('asks for foreground/background separation and photo indexes', () => {
    expect(prompt).toMatch(/isForeground/);
    expect(prompt).toMatch(/photoIndexes/);
    expect(prompt).toMatch(/bestPhotoIndex/);
    expect(prompt).toMatch(/background/i);
  });

  it('switches parent-facing strings to Japanese when asked', () => {
    const ja = createSubjectDetectionPrompt({ photoCount: 3, language: 'ja' });
    expect(ja).toMatch(/Japanese/);
    expect(prompt).not.toMatch(/Japanese/);
  });
});

describe('SUBJECT_DETECTION_RESPONSE_SCHEMA', () => {
  const subjectSchema = SUBJECT_DETECTION_RESPONSE_SCHEMA.properties.subjects.items;

  it('requires every subject field (strict mode)', () => {
    expect(subjectSchema.required).toEqual([
      'subjectId',
      'role',
      'kindGuess',
      'parentDescription',
      'defaultLabel',
      'isForeground',
      'physicalTraits',
      'typicalClothing',
      'styleTranslation',
      'photoIndexes',
      'bestPhotoIndex',
    ]);
    expect(subjectSchema.additionalProperties).toBe(false);
  });

  it('pins kindGuess to the AvatarKind enum', () => {
    expect(subjectSchema.properties.kindGuess.enum).toEqual(['CHILD', 'ADULT', 'PET', 'TOY']);
  });

  it('has no book/story fields at the top level', () => {
    expect(SUBJECT_DETECTION_RESPONSE_SCHEMA.required).toEqual(['subjects']);
  });
});

describe('SUBJECT_DETECTION_SYSTEM_PROMPT', () => {
  it('exists and frames the roster task', () => {
    expect(SUBJECT_DETECTION_SYSTEM_PROMPT.length).toBeGreaterThan(40);
  });
});
