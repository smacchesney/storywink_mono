import { describe, it, expect } from 'vitest';
import {
  createAvatarStoryQCPrompt,
  AvatarStoryQCInput,
  AVATAR_STORY_QC_RESPONSE_SCHEMA,
  AVATAR_STORY_QC_SYSTEM_PROMPT,
  STORY_QC_THRESHOLDS,
} from './story-check.js';

const baseInput: AvatarStoryQCInput = {
  storyArc: {
    desire: 'Emma wants to rescue the soggy teddy',
    obstacle: 'Teddy floated down the stream and out of reach',
    tryAndOvercome: 'Emma reaches, then builds a leaf-boat, then Grandma lifts her closer',
    refrain: 'Drip, drop, off we go!',
    emotionalPeak: 'The teddy is found under the big leaf',
    resolution: 'Everyone dries off together',
  },
  premise: 'A rainy-day rescue',
  pages: [
    { pageNumber: 1, text: 'Drip, drop! Rain taps the window.' },
    { pageNumber: 2, text: 'Where is Teddy? Emma looks everywhere.' },
  ],
  cast: [
    { name: 'Emma', role: 'main_child' },
    { name: 'Biscuit', role: 'pet' },
  ],
};

describe('createAvatarStoryQCPrompt', () => {
  it('renders the premise as the promise to deliver', () => {
    const prompt = createAvatarStoryQCPrompt(baseInput);
    expect(prompt).toContain('"A rainy-day rescue" — the story promised to deliver this.');
    expect(prompt).toContain('premiseTruth (0-10)');
  });

  it('drops captionRisk entirely — no photos exist', () => {
    const prompt = createAvatarStoryQCPrompt(baseInput);
    expect(prompt).not.toContain('captionRisk');
    expect(prompt).not.toContain('photo caption');
  });

  it('lists the cast so invented characters can be flagged', () => {
    const prompt = createAvatarStoryQCPrompt(baseInput);
    expect(prompt).toContain('- Emma (main child)');
    expect(prompt).toContain('- Biscuit (pet)');
    expect(prompt).toContain('no character outside this list may appear');
  });

  it('keeps premiseTruth OUT of the fail conditions (log-only)', () => {
    const prompt = createAvatarStoryQCPrompt(baseInput);
    const failLine = prompt.split('\n').find((l) => l.startsWith('If ANY of these fail'));
    expect(failLine).toBeDefined();
    expect(failLine).not.toContain('premiseTruth');
    expect(failLine).toContain('arcCoherence < 6');
    expect(failLine).toContain('lastPageLanding false');
  });

  it('scores soundOverload and agency but keeps BOTH log-only on avatar (S2/S3)', () => {
    const prompt = createAvatarStoryQCPrompt(baseInput);
    expect(prompt).toContain('soundOverload (boolean)');
    expect(prompt).toContain('agency (0-10)');
    const failLine = prompt.split('\n').find((l) => l.startsWith('If ANY of these fail'));
    expect(failLine).not.toContain('soundOverload');
    expect(failLine).not.toContain('agency');
  });

  it('stops praising sound words in the rhythm rubric', () => {
    const prompt = createAvatarStoryQCPrompt(baseInput);
    expect(prompt).not.toContain('organic sound words score high');
    expect(prompt).toContain('leaning on sound words does NOT');
  });

  it('renders the obstacle + try in the declared-arc block', () => {
    const prompt = createAvatarStoryQCPrompt(baseInput);
    expect(prompt).toContain('Obstacle:');
    expect(prompt).toContain('Try:');
  });

  it('adds the kanji rule for ja books only', () => {
    expect(createAvatarStoryQCPrompt(baseInput)).not.toContain('kanji');
    expect(createAvatarStoryQCPrompt({ ...baseInput, language: 'ja' })).toContain('NO kanji');
  });
});

describe('AVATAR_STORY_QC_RESPONSE_SCHEMA', () => {
  it('requires premiseTruth and drops captionRisk from pages', () => {
    expect(AVATAR_STORY_QC_RESPONSE_SCHEMA.required).toContain('premiseTruth');
    expect('truthToEvent' in AVATAR_STORY_QC_RESPONSE_SCHEMA.properties).toBe(false);
    const pageItems = AVATAR_STORY_QC_RESPONSE_SCHEMA.properties.pages.items;
    expect('captionRisk' in pageItems.properties).toBe(false);
    expect(pageItems.required).toEqual(['pageNumber', 'issue']);
  });

  it('adds soundOverload (required-nullable) and agency (required number) — S2/S3', () => {
    expect(AVATAR_STORY_QC_RESPONSE_SCHEMA.required).toContain('soundOverload');
    expect(AVATAR_STORY_QC_RESPONSE_SCHEMA.required).toContain('agency');
    expect(AVATAR_STORY_QC_RESPONSE_SCHEMA.properties.soundOverload.type).toEqual([
      'boolean',
      'null',
    ]);
    expect(AVATAR_STORY_QC_RESPONSE_SCHEMA.properties.agency.type).toBe('number');
  });
});

describe('thresholds and system prompt', () => {
  it('carries a log-only premiseTruth threshold', () => {
    expect(STORY_QC_THRESHOLDS.minPremiseTruth).toBe(6);
  });

  it('system prompt frames the invented-adventure review', () => {
    expect(AVATAR_STORY_QC_SYSTEM_PROMPT).toContain('invented adventure');
    expect(AVATAR_STORY_QC_SYSTEM_PROMPT).not.toContain('caption');
  });
});
