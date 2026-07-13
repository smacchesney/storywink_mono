import { describe, it, expect } from 'vitest';
import {
  createSubjectDetectionPrompt,
  SUBJECT_DETECTION_RESPONSE_SCHEMA,
  SUBJECT_DETECTION_SYSTEM_PROMPT,
  MAX_BATCH_PHOTOS,
  MAX_BATCH_SUBJECTS,
} from './photo-analysis.js';

describe('batch caps', () => {
  // Relational pins, not value mirrors: the owner retunes the constants; what
  // must never break is their SHAPE and that dependents track them. (The web
  // request schema tracking MAX_BATCH_PHOTOS is pinned in avatar-batch.test.ts.)
  it('are positive integers with photos ≥ subjects (each subject needs a photo)', () => {
    expect(Number.isInteger(MAX_BATCH_PHOTOS) && MAX_BATCH_PHOTOS > 0).toBe(true);
    expect(Number.isInteger(MAX_BATCH_SUBJECTS) && MAX_BATCH_SUBJECTS > 0).toBe(true);
    expect(MAX_BATCH_PHOTOS).toBeGreaterThanOrEqual(MAX_BATCH_SUBJECTS);
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

  it('admits every distinct beloved toy (toys-only batches are real), scenery guard intact', () => {
    // A parent introducing a child's toy cast uploads N different toys and
    // expects N characters — the roster must never cap toys at one. The
    // 2026-07-13 prod batch (6 toys → 1 subject) is the regression this pins.
    expect(prompt).not.toMatch(/at most one[^.\n]*(toy|object)/i);
    expect(prompt).toMatch(/every distinct[^.\n]*toy/i);
    expect(prompt).toMatch(/not scenery/i);
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
  it('frames the roster task: subjects described for an illustrator who never saw them', () => {
    expect(SUBJECT_DETECTION_SYSTEM_PROMPT).toMatch(/person, pet, and beloved toy/);
    expect(SUBJECT_DETECTION_SYSTEM_PROMPT).toMatch(/illustrator who has never seen them/);
  });
});
