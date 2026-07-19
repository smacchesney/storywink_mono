import { describe, it, expect } from 'vitest';
import { buildSubmitPatchBody } from './setup-submit';
import type { SetupFormState } from './SetupSheet';

const base: SetupFormState = {
  childName: ' Leo ',
  title: '',
  eventSummary: '',
  captureQuestions: [],
  artStyle: 'vignette',
  tone: null,
  learningWords: [],
  reviewFirst: false,
  themeLine: '',
  castMode: 'star',
  starCharacterId: null,
  castMemberIds: [],
};

describe('buildSubmitPatchBody', () => {
  it('keeps the legacy body byte-identical when X17 fields are untouched', () => {
    expect(buildSubmitPatchBody(base)).toEqual({
      childName: 'Leo',
      artStyle: 'vignette',
      autoIllustrate: true,
    });
  });

  it('adds themeLine and star binding when set', () => {
    const body = buildSubmitPatchBody({
      ...base,
      themeLine: ' a splashy beach day ',
      starCharacterId: 'child_2',
    });
    expect(body.themeLine).toBe('a splashy beach day');
    expect(body.castMode).toBe('star');
    expect(body.starCharacterId).toBe('child_2');
  });

  it('ensemble wins over a stale star pick', () => {
    const body = buildSubmitPatchBody({
      ...base,
      castMode: 'ensemble',
      starCharacterId: 'child_1',
      castMemberIds: ['child_1', 'child_2'],
    });
    expect(body.castMode).toBe('ensemble');
    expect(body.castMemberIds).toEqual(['child_1', 'child_2']);
    expect(body.starCharacterId).toBeNull();
  });

  it('legacy optionals still ride only when non-empty', () => {
    const body = buildSubmitPatchBody({
      ...base,
      title: ' T ',
      eventSummary: 'we swam',
      tone: 'silly',
      learningWords: ['splash'],
      reviewFirst: true,
    });
    expect(body).toMatchObject({
      title: 'T',
      eventSummary: 'we swam',
      tone: 'silly',
      learningWords: [{ word: 'splash' }],
      autoIllustrate: false,
    });
  });
});
