import { describe, it, expect } from 'vitest';
import {
  MAX_BATCH_PHOTOS,
  type DetectedSubject,
} from '@storywink/shared/prompts/photo-analysis';
import {
  detectRequestSchema,
  batchRequestSchema,
  buildIdentityFromDetection,
  subjectAssetIds,
  displayNameForPick,
  defaultSelected,
  roleForKind,
  kindForRole,
  AVATAR_KINDS,
  MAX_ASSETS_PER_SUBJECT,
} from './avatar-batch';

const cuid = (n: number) => `clx${'a'.repeat(18)}${String(n).padStart(3, '0')}`;

function subject(overrides: Partial<DetectedSubject> = {}): DetectedSubject {
  return {
    subjectId: 'adult_1',
    role: 'grandparent',
    kindGuess: 'ADULT',
    parentDescription: 'the silver-haired woman with round glasses',
    defaultLabel: 'Grown-up with glasses',
    isForeground: true,
    physicalTraits: {
      apparentAge: 'in her sixties',
      hairColor: 'silver-grey',
      hairStyle: 'short pixie cut',
      skinTone: 'warm beige',
      bodyBuild: 'slight',
      distinguishingFeatures: ['round gold-rimmed glasses'],
    },
    typicalClothing: 'a lavender cardigan over a white blouse',
    styleTranslation: 'soft watercolor washes with fine ink detail',
    photoIndexes: [1, 3, 4],
    bestPhotoIndex: 3,
    ...overrides,
  };
}

describe('detectRequestSchema', () => {
  it('accepts 1..10 owned-looking asset ids and an optional language', () => {
    expect(
      detectRequestSchema.safeParse({ assetIds: [cuid(1)], language: 'ja' }).success,
    ).toBe(true);
    expect(detectRequestSchema.safeParse({ assetIds: [] }).success).toBe(false);
  });

  it('tracks the shared photo cap, whatever the owner tunes it to', () => {
    expect(
      detectRequestSchema.safeParse({
        assetIds: Array.from({ length: MAX_BATCH_PHOTOS }, (_, i) => cuid(i)),
      }).success,
    ).toBe(true);
    expect(
      detectRequestSchema.safeParse({
        assetIds: Array.from({ length: MAX_BATCH_PHOTOS + 1 }, (_, i) => cuid(i)),
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate assetIds — photoIndexes are positional over this list', () => {
    expect(detectRequestSchema.safeParse({ assetIds: [cuid(1), cuid(1)] }).success).toBe(false);
  });
});

describe('batchRequestSchema', () => {
  const base = {
    detectionId: cuid(99),
    artStyle: 'vignette',
    picks: [{ subjectId: 'adult_1', kind: 'ADULT' }],
  };

  it('accepts picks with an optional name', () => {
    expect(batchRequestSchema.safeParse(base).success).toBe(true);
    expect(
      batchRequestSchema.safeParse({
        ...base,
        picks: [{ subjectId: 'adult_1', kind: 'ADULT', name: 'Nana' }],
      }).success,
    ).toBe(true);
  });

  it('rejects unknown styles, unknown kinds, and empty picks', () => {
    expect(batchRequestSchema.safeParse({ ...base, artStyle: 'not-a-style' }).success).toBe(false);
    expect(
      batchRequestSchema.safeParse({
        ...base,
        picks: [{ subjectId: 'adult_1', kind: 'ROBOT' }],
      }).success,
    ).toBe(false);
    expect(batchRequestSchema.safeParse({ ...base, picks: [] }).success).toBe(false);
  });

  it('rejects duplicate subjectIds — one avatar per subject', () => {
    expect(
      batchRequestSchema.safeParse({
        ...base,
        picks: [
          { subjectId: 'adult_1', kind: 'ADULT' },
          { subjectId: 'adult_1', kind: 'CHILD' },
        ],
      }).success,
    ).toBe(false);
  });

  it('caps picks at the shared subject cap (6)', () => {
    expect(
      batchRequestSchema.safeParse({
        ...base,
        picks: Array.from({ length: 7 }, (_, i) => ({ subjectId: `s${i}`, kind: 'CHILD' })),
      }).success,
    ).toBe(false);
  });

  it('rejects names over 50 characters', () => {
    expect(
      batchRequestSchema.safeParse({
        ...base,
        picks: [{ subjectId: 'adult_1', kind: 'ADULT', name: 'x'.repeat(51) }],
      }).success,
    ).toBe(false);
  });
});

describe('buildIdentityFromDetection', () => {
  it('builds the AvatarIdentity shape with the display name and vignette baseline', () => {
    const identity = buildIdentityFromDetection(subject(), 'Nana', 'ADULT');
    expect(identity.extractedForStyle).toBe('vignette');
    expect(identity.character.characterId).toBe('avatar_subject');
    expect(identity.character.name).toBe('Nana');
    expect(identity.character.role).toBe('adult');
    expect(identity.character.physicalTraits.hairColor).toBe('silver-grey');
    expect(identity.character.typicalClothing).toBe('a lavender cardigan over a white blouse');
    expect(identity.character.styleTranslation).toContain('watercolor');
  });

  it('the role follows the PARENT-CHOSEN kind, not the detection guess', () => {
    const identity = buildIdentityFromDetection(subject(), 'Kai', 'CHILD');
    expect(identity.character.role).toBe('main_child');
  });

  it('never copies parent-facing strings into the identity', () => {
    const identity = buildIdentityFromDetection(subject(), 'Nana', 'ADULT');
    const flat = JSON.stringify(identity);
    expect(flat).not.toContain('Grown-up with glasses');
    expect(flat).not.toContain('silver-haired woman');
  });
});

describe('roleForKind', () => {
  it('maps every kind to its roster role', () => {
    expect(roleForKind('CHILD')).toBe('main_child');
    expect(roleForKind('ADULT')).toBe('adult');
    expect(roleForKind('PET')).toBe('pet');
    expect(roleForKind('TOY')).toBe('companion_object');
  });

  it('round-trips with kindForRole for every kind — batch-created avatars must promote back to the same kind', () => {
    for (const kind of AVATAR_KINDS) {
      expect(kindForRole(roleForKind(kind))).toBe(kind);
    }
  });
});

describe('subjectAssetIds', () => {
  const assetIds = [cuid(1), cuid(2), cuid(3), cuid(4), cuid(5)];

  it('leads with the best photo, keeps at most 3, all from the uploaded set', () => {
    const ids = subjectAssetIds(subject({ photoIndexes: [1, 3, 4, 5], bestPhotoIndex: 3 }), assetIds);
    expect(ids.length).toBe(MAX_ASSETS_PER_SUBJECT);
    expect(ids[0]).toBe(assetIds[2]); // best photo (index 3, 1-based) first
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(assetIds).toContain(id));
  });

  it('ignores out-of-range and duplicate indexes from the model', () => {
    const ids = subjectAssetIds(
      subject({ photoIndexes: [0, 2, 2, 99], bestPhotoIndex: 42 }),
      assetIds,
    );
    expect(ids).toEqual([assetIds[1]]);
  });

  it('returns empty when the model gave nothing usable', () => {
    expect(subjectAssetIds(subject({ photoIndexes: [], bestPhotoIndex: 0 }), assetIds)).toEqual([]);
  });
});

describe('displayNameForPick', () => {
  it('prefers the typed name, trimmed and capped at 50', () => {
    expect(displayNameForPick('  Nana  ', subject())).toBe('Nana');
    expect(displayNameForPick('x'.repeat(60), subject()).length).toBe(50);
  });

  it('falls back to the detection defaultLabel, then a kind word', () => {
    expect(displayNameForPick(undefined, subject())).toBe('Grown-up with glasses');
    expect(displayNameForPick('', subject({ defaultLabel: '' }))).toBe('Someone special');
  });

  it('the static fallback follows the detection language — no English name on a Japanese shelf', () => {
    expect(displayNameForPick('', subject({ defaultLabel: ' ' }), 'ja')).toBe('たいせつな ひと');
    expect(displayNameForPick('', subject({ defaultLabel: '' }), 'en')).toBe('Someone special');
  });
});

describe('defaultSelected', () => {
  it('selects subjects in 2+ photos or clearly foreground; background one-offs stay unselected', () => {
    expect(defaultSelected(subject({ photoIndexes: [1, 2], isForeground: false }))).toBe(true);
    expect(defaultSelected(subject({ photoIndexes: [1], isForeground: true }))).toBe(true);
    expect(defaultSelected(subject({ photoIndexes: [1], isForeground: false }))).toBe(false);
  });
});
