import { describe, it, expect, vi } from 'vitest';

// CaptureChips resolves `cn` via the Next.js `@/` path alias, which the root
// vitest config does not configure (house idiom: rateLimit.test.ts does the
// same for `@/lib/logger`). Stub it so the module graph loads.
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { ensureMemberNamingQuestions } from './star-ask';
import { orderQuestions, type CaptureQuestion } from './CaptureChips';
import type { RosterCharacterLike } from './discovery-feed';

const member = (id: string, name: string | null): RosterCharacterLike => ({
  characterId: id,
  role: 'sibling',
  name,
  appearsOnPages: [1, 2],
});

describe('ensureMemberNamingQuestions', () => {
  it('adds naming rows only for unnamed, uncovered members', () => {
    const existing: CaptureQuestion[] = [
      { id: 'q1', question: 'Who is this?', options: ['Grandma'], characterId: 'adult_1' },
    ];
    const out = ensureMemberNamingQuestions(
      existing,
      [member('child_1', 'Leo'), member('child_2', null), member('adult_1', null)],
      (d) => `What should we call ${d}?`,
    );
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      id: 'name_child_2',
      characterId: 'child_2',
      kind: 'naming',
      options: [],
      answer: null,
    });
  });

  it('caps the list at 10 (PATCH schema bound)', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `q${i}`,
      question: 'x',
      options: [],
    })) as CaptureQuestion[];
    const out = ensureMemberNamingQuestions(
      many,
      [member('child_1', null), member('child_2', null)],
      (d) => d,
    );
    expect(out).toHaveLength(10);
  });
});

describe('orderQuestions caps', () => {
  const naming = (id: string): CaptureQuestion => ({
    id,
    question: 'name?',
    options: [],
    characterId: id,
  });
  it('default keeps the legacy 2-naming/3-total shape', () => {
    const rows = orderQuestions([naming('a'), naming('b'), naming('c')]);
    expect(rows.map((q) => q.id)).toEqual(['a', 'b', 'c']);
    expect(orderQuestions([naming('a'), naming('b'), naming('c'), naming('d')])).toHaveLength(3);
  });
  it('ensemble caps allow 4 naming rows', () => {
    const rows = orderQuestions([naming('a'), naming('b'), naming('c'), naming('d')], {
      naming: 4,
      total: 5,
    });
    expect(rows).toHaveLength(4);
  });
  it('hides non-naming ramble fact rows from the chips UI', () => {
    const rows = orderQuestions([
      { id: 'ramble_highlight', question: 'Best moment', options: [], answer: 'the big wave' },
      naming('a'),
    ]);
    expect(rows.map((q) => q.id)).toEqual(['a']);
  });
});
