import { describe, it, expect } from 'vitest';
import {
  buildRambleExtractPrompt,
  isLikelyPersonName,
  sanitizeRambleExtraction,
} from './ramble-extract';

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

describe('X17.2 P0b — isLikelyPersonName + sanitize filtering', () => {
  it.each([
    'parent_or_uncle',
    'friend',
    'main_child',
    'sibling',
    'uncle',
    'grandma',
    'DADDY',
    'ともだち',
  ])('rejects role/relationship token %s', (token) =>
    expect(isLikelyPersonName(token)).toBe(false),
  );
  it.each(['Kai', 'Uncle Jon', 'Astrid', 'あすか', 'Mary Jane'])('accepts real name %s', (name) =>
    expect(isLikelyPersonName(name)).toBe(true),
  );
  it('rejects underscore tokens, empties, digits-only, and 5+ word strings', () => {
    expect(isLikelyPersonName('a_b')).toBe(false);
    expect(isLikelyPersonName('  ')).toBe(false);
    expect(isLikelyPersonName('123')).toBe(false);
    expect(isLikelyPersonName('the little boy in stripes')).toBe(false);
  });
  it('sanitizeRambleExtraction drops non-name people and non-name starName', () => {
    const out = sanitizeRambleExtraction(
      {
        starName: 'main_child',
        people: [
          { characterId: 'child_1', name: 'Astrid' },
          { characterId: 'adult_1', name: 'parent_or_uncle' },
          { characterId: 'child_4', name: 'friend' },
        ],
        location: 'legoland',
        highlight: null,
        mishap: null,
        childSaid: null,
        themeLine: null,
      },
      ['child_1', 'adult_1', 'child_4'],
    );
    expect(out.starName).toBeNull();
    expect(out.people).toEqual([{ characterId: 'child_1', name: 'Astrid' }]);
  });
});
