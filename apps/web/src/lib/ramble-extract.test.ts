import { describe, it, expect } from 'vitest';
import { buildRambleExtractPrompt, sanitizeRambleExtraction } from './ramble-extract';

describe('buildRambleExtractPrompt', () => {
  it('includes roster ids, theme guess, and the ramble', () => {
    const prompt = buildRambleExtractPrompt({
      ramble: 'Leo and his sister Maya swam all day',
      roster: [
        { characterId: 'child_1', role: 'main_child', name: null, descriptor: 'a little one' },
      ],
      themeLine: 'a splashy beach day',
      language: 'en',
    });
    expect(prompt).toContain('child_1: main_child — a little one');
    expect(prompt).toContain('Current theme guess: a splashy beach day');
    expect(prompt).toContain('Leo and his sister Maya swam all day');
    expect(prompt).not.toContain('Japanese');
  });
  it('flags Japanese output for ja books and (none) for a missing theme', () => {
    const prompt = buildRambleExtractPrompt({
      ramble: 'x',
      roster: [],
      themeLine: null,
      language: 'ja',
    });
    expect(prompt).toContain('Japanese');
    expect(prompt).toContain('Current theme guess: (none)');
  });
});

describe('sanitizeRambleExtraction', () => {
  it('caps lengths, trims, and nulls empties', () => {
    const out = sanitizeRambleExtraction(
      {
        starName: `  ${'L'.repeat(80)}  `,
        people: [{ characterId: 'child_1', name: ' Maya ' }],
        location: '',
        highlight: 'the big wave',
        mishap: null,
        childSaid: 42,
        themeLine: 'Y'.repeat(300),
      },
      ['child_1'],
    );
    expect(out.starName).toHaveLength(50);
    expect(out.people).toEqual([{ characterId: 'child_1', name: 'Maya' }]);
    expect(out.location).toBeNull();
    expect(out.highlight).toBe('the big wave');
    expect(out.childSaid).toBeNull();
    expect(out.themeLine).toHaveLength(120);
  });
  it('drops characterIds not in the roster and unnamed people; caps at 6', () => {
    const out = sanitizeRambleExtraction(
      {
        starName: null,
        people: [
          { characterId: 'evil_injection', name: 'X' },
          { characterId: null, name: '' },
          ...Array.from({ length: 8 }, (_, i) => ({ characterId: null, name: `P${i}` })),
        ],
        location: null,
        highlight: null,
        mishap: null,
        childSaid: null,
        themeLine: null,
      },
      ['child_1'],
    );
    expect(out.people).toHaveLength(6);
    expect(out.people[0]).toEqual({ characterId: null, name: 'X' });
  });
  it('never throws on garbage', () => {
    expect(sanitizeRambleExtraction(null, []).people).toEqual([]);
    expect(sanitizeRambleExtraction('junk', []).starName).toBeNull();
  });
});
