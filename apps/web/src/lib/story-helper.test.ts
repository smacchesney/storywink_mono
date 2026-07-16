import { describe, it, expect } from 'vitest';
import {
  helperStepEnabled,
  avatarStorySteps,
  stepIndexOf,
  nextStep,
  prevStep,
  storyProposalSignature,
  sanitizeStoryProposal,
  finalPremiseFor,
  nextIdeaIndex,
  STORYLINE_MAX,
  STORY_PROPOSAL_SYSTEM_PROMPT,
  buildStoryProposalPrompt,
  type StoryProposalInput,
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
  const base = {
    premise: 'a puddle rescue',
    castIds: ['a1', 'a2'],
    pageLength: 12,
    language: 'en',
  };

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

describe('nextIdeaIndex (pool-only "More ideas")', () => {
  it('advances through the pool and wraps at the end', () => {
    expect(nextIdeaIndex(3, 0)).toBe(1);
    expect(nextIdeaIndex(3, 1)).toBe(2);
    expect(nextIdeaIndex(3, 2)).toBe(0);
  });

  it('is a no-op-safe 0 for an empty or single-item pool', () => {
    expect(nextIdeaIndex(0, 0)).toBe(0);
    expect(nextIdeaIndex(1, 0)).toBe(0);
  });
});

describe('STORY_PROPOSAL_SYSTEM_PROMPT (ramble handling pins)', () => {
  it('tells the model the idea may be a spoken ramble', () => {
    expect(STORY_PROPOSAL_SYSTEM_PROMPT).toContain('spoken ramble');
  });

  it("keeps the parent's own words where they sparkle", () => {
    expect(STORY_PROPOSAL_SYSTEM_PROMPT).toContain("keep the parent's own words");
    expect(STORY_PROPOSAL_SYSTEM_PROMPT).toContain('sparkle');
  });

  it('still forbids replacing the idea and keeps every named character', () => {
    expect(STORY_PROPOSAL_SYSTEM_PROMPT).toContain('never replacing it');
    expect(STORY_PROPOSAL_SYSTEM_PROMPT).toContain('keep every character they named');
  });

  it('never uses an em dash (house prose rule)', () => {
    expect(STORY_PROPOSAL_SYSTEM_PROMPT).not.toContain('—');
  });
});

describe('buildStoryProposalPrompt (goal + cast pins)', () => {
  const input: StoryProposalInput = {
    cast: [
      { name: 'Maya', kind: 'CHILD', isStar: true },
      { name: 'Rex', kind: 'PET', isStar: false },
    ],
    premise: 'a dragon scared of the dark',
    pageLength: 12,
    language: 'en',
  };

  it('requires the storyline to name the star’s goal', () => {
    const out = buildStoryProposalPrompt(input);
    expect(out).toContain('NAMES what the star is trying to do (their goal)');
  });

  it('quotes the premise and lists the cast with the star marked', () => {
    const out = buildStoryProposalPrompt(input);
    expect(out).toContain('"a dragon scared of the dark"');
    expect(out).toContain('- Maya (child, the star)');
    expect(out).toContain('- Rex (pet)');
    expect(out).toContain('12-page picture book');
  });

  it('pins both length caps to STORYLINE_MAX and asks for exactly two alternates', () => {
    const out = buildStoryProposalPrompt(input);
    expect(out).toContain(`at most ${STORYLINE_MAX} characters`);
    expect(out).toContain('exactly TWO other short takes');
  });

  it('keeps the original gentle-ending tone (any tone change belongs to Track S)', () => {
    expect(buildStoryProposalPrompt(input)).toContain('a gentle ending');
  });

  it('switches the language note for ja', () => {
    expect(buildStoryProposalPrompt(input)).toContain('warm, simple English');
    expect(buildStoryProposalPrompt({ ...input, language: 'ja' })).toContain(
      'natural, warm Japanese',
    );
  });
});

describe('finalPremiseFor (X11 accept→preset guard)', () => {
  it('substitutes the accepted storyline only on the write-your-own path', () => {
    expect(finalPremiseFor(true, 'a puddle rescue', 'raw spark')).toBe('a puddle rescue');
  });

  it('trims the accepted storyline before substituting', () => {
    expect(finalPremiseFor(true, '  a puddle rescue  ', 'raw spark')).toBe('a puddle rescue');
  });

  it('ignores an abandoned accepted storyline when a PRESET is chosen (the bug)', () => {
    // Parent wrote custom, accepted a proposal, backed out to spark, then picked
    // a preset (writingOwn=false). The preset premise must win — never the stale
    // authored storyline that enterShape never got a chance to clear.
    expect(finalPremiseFor(false, 'abandoned custom storyline', 'The Lost Balloon')).toBe(
      'The Lost Balloon',
    );
  });

  it('falls back to the raw premise when nothing was accepted (skip / fail-open)', () => {
    expect(finalPremiseFor(true, '', 'raw spark')).toBe('raw spark');
    expect(finalPremiseFor(true, '   ', 'raw spark')).toBe('raw spark');
  });

  it('lets a re-authored storyline substitute again after an accept→preset detour', () => {
    // preset detour lands on the preset premise …
    expect(finalPremiseFor(false, 'old accepted', 'A Rainy Day')).toBe('A Rainy Day');
    // … and switching back to write-your-own and accepting again still substitutes.
    expect(finalPremiseFor(true, 'freshly re-authored', 'my custom spark')).toBe(
      'freshly re-authored',
    );
  });
});
