import { describe, it, expect } from 'vitest';
import {
  helperStepEnabled,
  avatarStorySteps,
  stepIndexOf,
  nextStep,
  prevStep,
  storyProposalSignature,
  sanitizeStoryProposal,
  STORYLINE_MAX,
} from './story-helper';

describe('helperStepEnabled', () => {
  it('needs BOTH the write-your-own path and the flag', () => {
    expect(helperStepEnabled(true, true)).toBe(true);
    expect(helperStepEnabled(true, false)).toBe(false);
    expect(helperStepEnabled(false, true)).toBe(false);
    expect(helperStepEnabled(false, false)).toBe(false);
  });
});

describe('avatarStorySteps (D1 stable dot count)', () => {
  it('is 4 steps with the helper, 3 without', () => {
    expect(avatarStorySteps(true)).toEqual(['cast', 'spark', 'shape', 'length']);
    expect(avatarStorySteps(false)).toEqual(['cast', 'spark', 'length']);
  });

  it('only exposes shape when the helper is enabled', () => {
    expect(avatarStorySteps(true)).toContain('shape');
    expect(avatarStorySteps(false)).not.toContain('shape');
  });
});

describe('stepIndexOf', () => {
  it('places length last in both shapes; shape is absent when disabled', () => {
    expect(stepIndexOf('length', true)).toBe(3);
    expect(stepIndexOf('length', false)).toBe(2);
    expect(stepIndexOf('shape', true)).toBe(2);
    expect(stepIndexOf('shape', false)).toBe(-1);
    expect(stepIndexOf('cast', true)).toBe(0);
    expect(stepIndexOf('cast', false)).toBe(0);
  });
});

describe('nextStep (spark Next routing)', () => {
  it('routes spark to shape when enabled, straight to length when not', () => {
    expect(nextStep('spark', true)).toBe('shape');
    expect(nextStep('spark', false)).toBe('length');
  });

  it('walks shape to length and stops at length', () => {
    expect(nextStep('shape', true)).toBe('length');
    expect(nextStep('length', true)).toBeNull();
    expect(nextStep('length', false)).toBeNull();
    expect(nextStep('cast', false)).toBe('spark');
  });
});

describe('prevStep (back-button routing)', () => {
  it('walks length back to shape when enabled, to spark when not', () => {
    expect(prevStep('length', true)).toBe('shape');
    expect(prevStep('length', false)).toBe('spark');
  });

  it('walks shape back to spark, spark back to cast, and stops at cast', () => {
    expect(prevStep('shape', true)).toBe('spark');
    expect(prevStep('spark', true)).toBe('cast');
    expect(prevStep('spark', false)).toBe('cast');
    expect(prevStep('cast', true)).toBeNull();
    expect(prevStep('cast', false)).toBeNull();
  });
});

describe('storyProposalSignature (D2 memo key)', () => {
  const base = { premise: 'a puddle rescue', castIds: ['a1', 'a2'], pageLength: 12, language: 'en' };

  it('is stable for identical inputs', () => {
    expect(storyProposalSignature(base)).toBe(storyProposalSignature({ ...base }));
  });

  it('changes when any signature field changes', () => {
    expect(storyProposalSignature({ ...base, premise: 'other' })).not.toBe(
      storyProposalSignature(base),
    );
    expect(storyProposalSignature({ ...base, castIds: ['a1'] })).not.toBe(
      storyProposalSignature(base),
    );
    expect(storyProposalSignature({ ...base, pageLength: 16 })).not.toBe(
      storyProposalSignature(base),
    );
    expect(storyProposalSignature({ ...base, language: 'ja' })).not.toBe(
      storyProposalSignature(base),
    );
  });

  it('is cast-order sensitive (pick order picks the star)', () => {
    expect(storyProposalSignature({ ...base, castIds: ['a2', 'a1'] })).not.toBe(
      storyProposalSignature(base),
    );
  });
});

describe('sanitizeStoryProposal (D3 post-parse bounds)', () => {
  it('clamps the storyline to 280 chars and trims', () => {
    const long = 'x'.repeat(400);
    const out = sanitizeStoryProposal({ storyline: `  ${long}  `, alternates: [] });
    expect(out.storyline.length).toBe(STORYLINE_MAX);
    expect(out.storyline).toBe('x'.repeat(280));
  });

  it('keeps at most 2 alternates and drops the rest', () => {
    const out = sanitizeStoryProposal({
      storyline: 'main',
      alternates: ['one', 'two', 'three', 'four'],
    });
    expect(out.alternates).toEqual(['one', 'two']);
  });

  it('drops empty and non-string alternates and clamps each', () => {
    const long = 'y'.repeat(400);
    const out = sanitizeStoryProposal({
      storyline: 'main',
      alternates: ['  ', 42, '  keep me  ', long],
    });
    expect(out.alternates[0]).toBe('keep me');
    expect(out.alternates[1].length).toBe(STORYLINE_MAX);
    expect(out.alternates.length).toBe(2);
  });

  it('survives garbage / missing input without throwing', () => {
    expect(sanitizeStoryProposal(null)).toEqual({ storyline: '', alternates: [] });
    expect(sanitizeStoryProposal({})).toEqual({ storyline: '', alternates: [] });
    expect(sanitizeStoryProposal({ storyline: 123, alternates: 'nope' })).toEqual({
      storyline: '',
      alternates: [],
    });
  });
});
