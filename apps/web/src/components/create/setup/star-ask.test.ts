import { describe, it, expect, vi } from 'vitest';

// CaptureChips resolves `cn` via the Next.js `@/` path alias, which the root
// vitest config does not configure (house idiom: rateLimit.test.ts does the
// same for `@/lib/logger`). Stub it so the module graph loads.
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { ensureMemberNamingQuestions, mergeCaptureQuestions } from './star-ask';
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

  it('caps synthetic naming rows at 4 for big-party ensembles', () => {
    const members = Array.from({ length: 8 }, (_, i) => member(`child_${i}`, null));
    const out = ensureMemberNamingQuestions([], members, (d) => d);
    expect(out).toHaveLength(4);
    expect(out.every((q) => q.id.startsWith('name_'))).toBe(true);
  });

  it('counts pre-existing name_ rows toward the 4-row cap', () => {
    const existing: CaptureQuestion[] = [
      { id: 'name_a', question: 'x', options: [], characterId: 'a', kind: 'naming', answer: null },
      { id: 'name_b', question: 'x', options: [], characterId: 'b', kind: 'naming', answer: null },
    ];
    const members = Array.from({ length: 8 }, (_, i) => member(`child_${i}`, null));
    const out = ensureMemberNamingQuestions(existing, members, (d) => d);
    // 2 existing name_ rows leave only 2 synthetic slots → 4 naming rows total.
    expect(out).toHaveLength(4);
    expect(out.filter((q) => q.id.startsWith('name_child_'))).toHaveLength(2);
  });
});

describe('mergeCaptureQuestions', () => {
  const q = (id: string): CaptureQuestion => ({ id, question: 'x', options: [] });
  const nameRow = (id: string, answer: string | null = null): CaptureQuestion => ({
    id: `name_${id}`,
    question: `What should we call ${id}?`,
    options: [],
    characterId: id,
    kind: 'naming',
    answer,
  });

  it('returns the server list verbatim when no local synthetics exist', () => {
    const server = [q('a'), q('b')];
    const out = mergeCaptureQuestions(server, [q('a')]);
    // Byte-identical legacy behavior: same reference, no copy.
    expect(out).toBe(server);
  });

  it('keeps both when local synthetics are absent from a fresh server list', () => {
    const server = [q('perc_1')];
    const local = [q('perc_1'), nameRow('child_2')];
    const out = mergeCaptureQuestions(server, local);
    expect(out.map((r) => r.id)).toEqual(['perc_1', 'name_child_2']);
  });

  it('dedupes once the server echoes the same name_ id, server version wins', () => {
    const server = [q('perc_1'), nameRow('child_2', 'Mia')];
    const local = [q('perc_1'), nameRow('child_2', null)];
    const out = mergeCaptureQuestions(server, local);
    expect(out.map((r) => r.id)).toEqual(['perc_1', 'name_child_2']);
    expect(out.find((r) => r.id === 'name_child_2')?.answer).toBe('Mia');
  });

  it('survives an empty server list — synthetics are preserved', () => {
    const local = [nameRow('child_1'), nameRow('child_2')];
    const out = mergeCaptureQuestions([], local);
    expect(out.map((r) => r.id)).toEqual(['name_child_1', 'name_child_2']);
  });

  it('preserves local ramble_* rows the server has not echoed yet (B4)', () => {
    const server = [q('perc_1')];
    const local: CaptureQuestion[] = [
      q('perc_1'),
      { id: 'ramble_location', question: 'Where', options: [], answer: 'Camber Sands' },
      {
        id: 'ramble_name_adult_1',
        question: 'Who',
        options: [],
        characterId: 'adult_1',
        answer: 'Nana',
      },
    ];
    const out = mergeCaptureQuestions(server, local);
    expect(out.map((r) => r.id)).toEqual(['perc_1', 'ramble_location', 'ramble_name_adult_1']);
  });

  it('dedupes once the server echoes a ramble_* id, server version wins', () => {
    const server = [
      q('perc_1'),
      { id: 'ramble_location', question: 'Where', options: [], answer: 'Camber Sands' },
    ];
    const local = [
      q('perc_1'),
      { id: 'ramble_location', question: 'Where', options: [], answer: 'the beach' },
    ];
    const out = mergeCaptureQuestions(server, local);
    expect(out.map((r) => r.id)).toEqual(['perc_1', 'ramble_location']);
    expect(out.find((r) => r.id === 'ramble_location')?.answer).toBe('Camber Sands');
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
