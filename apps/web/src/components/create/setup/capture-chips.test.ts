import { describe, it, expect, vi } from 'vitest';

// CaptureChips resolves `cn` via the Next.js `@/` path alias, which the root
// vitest config does not configure — stub it so the module graph loads
// (house idiom; star-ask.test.ts:1-8 does exactly this for the same module).
// discovery-client needs NO stub: CaptureChips imports it RELATIVELY (see the
// threading step below) and it is a pure env-read constant module.
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { orderQuestions } from './CaptureChips';

describe('X17.2 — flag-on CaptureChips keeps only non-naming questions', () => {
  const rows = [
    {
      id: 'q1',
      question: 'Who is the man?',
      options: ['Daddy'],
      characterId: 'adult_1',
      kind: 'naming' as const,
    },
    {
      id: 'q2',
      question: 'Does the bunny have a name?',
      options: [],
      characterId: 'object_1',
      kind: 'object' as const,
    },
    {
      id: 'q3',
      question: 'Highlight?',
      options: ['The splash'],
      characterId: null,
      kind: 'other' as const,
    },
    {
      id: 'ramble_name_child_1',
      question: 'name?',
      options: [],
      characterId: 'child_1',
      kind: 'naming' as const,
    },
    {
      id: 'ramble_location',
      question: 'Where',
      options: [],
      characterId: null,
      kind: 'other' as const,
    },
  ];
  it('dropNaming: drops naming rows (face row owns them) and hidden ramble facts, keeps object + other', () => {
    expect(orderQuestions(rows, undefined, true).map((q) => q.id)).toEqual(['q2', 'q3']);
  });
  it('dropNaming + legacy rows without kind: characterId non-object rows are naming → dropped', () => {
    const legacy = [{ id: 'q1', question: 'Who?', options: ['Grandma'], characterId: 'adult_1' }];
    expect(orderQuestions(legacy, undefined, true)).toEqual([]);
  });
  it('default (flag-off) is byte-identical: naming rows render first, exactly as today', () => {
    expect(orderQuestions(rows).map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
  });
});
