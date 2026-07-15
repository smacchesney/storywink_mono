import { describe, it, expect } from 'vitest';
import {
  castComposition,
  buildAvatarStoryRoster,
  sharedReadyStyles,
  autoSelectAfterCreate,
  nextArrivalPollStart,
  MAX_CAST,
  type CastKind,
} from './avatar-story';

describe('castComposition', () => {
  it('accepts a lone person, a lone pet, or a lone toy — one character is enough', () => {
    expect(castComposition(['CHILD']).ok).toBe(true);
    expect(castComposition(['PET']).ok).toBe(true);
    expect(castComposition(['TOY']).ok).toBe(true);
  });

  it('accepts a pets-and-toys-only cast (no person required — the parent decides)', () => {
    expect(castComposition(['PET', 'TOY']).ok).toBe(true);
    expect(castComposition(['PET', 'PET', 'TOY']).ok).toBe(true);
  });

  it('accepts five or six people (no people cap)', () => {
    expect(castComposition(['CHILD', 'ADULT', 'ADULT', 'ADULT', 'ADULT']).ok).toBe(true);
    expect(castComposition(['CHILD', 'ADULT', 'ADULT', 'ADULT', 'ADULT', 'ADULT']).ok).toBe(true);
  });

  it('accepts three or more companions up to the total (no companion cap)', () => {
    expect(castComposition(['CHILD', 'PET', 'PET', 'TOY']).ok).toBe(true);
    expect(castComposition(['PET', 'PET', 'TOY', 'TOY', 'PET', 'TOY']).ok).toBe(true);
  });

  it('rejects an empty cast', () => {
    expect(castComposition([]).ok).toBe(false);
  });

  it('rejects a cast past the total ceiling (the illustration reference budget)', () => {
    expect(
      castComposition(['CHILD', 'ADULT', 'PET', 'TOY', 'PET', 'TOY', 'PET']).ok,
    ).toBe(false); // 7 > MAX_CAST
  });

  it('still reports people and companion counts', () => {
    const c = castComposition(['CHILD', 'ADULT', 'PET', 'TOY']);
    expect(c.people).toBe(2);
    expect(c.companions).toBe(2);
  });

  it('exports the total ceiling the UI and server mirror', () => {
    expect(MAX_CAST).toBe(6);
  });
});

describe('buildAvatarStoryRoster', () => {
  const emma = {
    id: 'a1',
    displayName: 'Emma',
    kind: 'CHILD' as const,
    identity: {
      physicalTraits: { hairColor: 'brown', apparentAge: '3 years' },
      typicalClothing: 'striped tee',
      styleTranslation: 'soft pencil',
    },
  };
  const grandma = { id: 'a2', displayName: 'Grandma', kind: 'ADULT' as const, identity: null };
  const biscuit = { id: 'a3', displayName: 'Biscuit', kind: 'PET' as const, identity: null };

  it('mints avatar_N ids in pick order and stars the first CHILD', () => {
    const { characters, childName } = buildAvatarStoryRoster([grandma, emma, biscuit]);
    expect(characters.map(c => c.characterId)).toEqual(['avatar_1', 'avatar_2', 'avatar_3']);
    expect(characters[1].role).toBe('main_child');
    expect(characters[1].namedVia).toBe('childName');
    expect(characters[0].role).toBe('grown-up');
    expect(characters[0].namedVia).toBe('chip');
    expect(characters[2].role).toBe('pet');
    expect(childName).toBe('Emma');
  });

  it('a second child stays a supporting child', () => {
    const zoe = { ...emma, id: 'a4', displayName: 'Zoe' };
    const { characters } = buildAvatarStoryRoster([emma, zoe]);
    expect(characters[0].role).toBe('main_child');
    expect(characters[1].role).toBe('child');
  });

  it('carries identity fields and fills gaps with sheet-pointing placeholders', () => {
    const { characters } = buildAvatarStoryRoster([emma, grandma]);
    expect(characters[0].physicalTraits.hairColor).toBe('brown');
    expect(characters[0].typicalClothing).toBe('striped tee');
    expect(characters[1].physicalTraits.hairColor).toBe('as shown on the character sheet');
    expect(characters[1].physicalTraits.apparentAge).toBe('adult');
    expect(characters[1].styleTranslation).toBe('');
  });

  it('no CHILD in cast → childName null, nobody starred', () => {
    const { characters, childName } = buildAvatarStoryRoster([grandma, biscuit]);
    expect(childName).toBeNull();
    expect(characters.every(c => c.role !== 'main_child')).toBe(true);
  });

  it('roster enters page-less', () => {
    const { characters } = buildAvatarStoryRoster([emma]);
    expect(characters[0].appearsOnPages).toEqual([]);
    expect(characters[0].appearsOnAssetIds).toEqual([]);
  });

  it('carries the stored species label through to the roster (A4 name↔sheet map)', () => {
    // Without this, the extraction's species never reaches the render — the
    // illustration worker reads Book.characterIdentity, which is THIS output.
    const grypho = {
      id: 'a5',
      displayName: 'Grypho',
      kind: 'TOY' as const,
      identity: { species: 'toy crocodile' },
    };
    const { characters } = buildAvatarStoryRoster([grypho, emma]);
    expect(characters[0].species).toBe('toy crocodile');
    // Identities without the field (pre-species avatars) stay species-less so
    // the worker's speciesLineFor fallback distillation kicks in.
    expect(characters[1].species).toBeNull();
  });
});

describe('autoSelectAfterCreate', () => {
  const member = (id: string, kind: CastKind) => ({ id, kind });

  it('adds a fresh person to an empty cast', () => {
    const cast: { id: string; kind: CastKind }[] = [];
    expect(autoSelectAfterCreate(cast, member('new', 'CHILD'))).toBe(true);
  });

  it('adds a fresh pet dropped into an empty cast (pets-only casts are valid now)', () => {
    // The person-required floor is gone: a lone companion is a legal cast, so
    // the character the parent just made auto-selects like any other.
    const cast: { id: string; kind: CastKind }[] = [];
    expect(autoSelectAfterCreate(cast, member('new', 'PET'))).toBe(true);
  });

  it('adds a fresh person past the old 4-person cap', () => {
    const cast = [
      member('a', 'CHILD'),
      member('b', 'ADULT'),
      member('c', 'ADULT'),
      member('d', 'ADULT'),
    ];
    expect(autoSelectAfterCreate(cast, member('e', 'ADULT'))).toBe(true); // 5 ≤ MAX_CAST
  });

  it('adds a fresh companion past the old 2-companion cap', () => {
    const cast = [member('a', 'CHILD'), member('b', 'PET'), member('c', 'TOY')];
    expect(autoSelectAfterCreate(cast, member('d', 'PET'))).toBe(true); // 3 companions, total 4
  });

  it('skips a 7th character (total ceiling) so the parent chooses', () => {
    const cast = [
      member('a', 'CHILD'),
      member('b', 'ADULT'),
      member('c', 'PET'),
      member('d', 'TOY'),
      member('e', 'PET'),
      member('f', 'TOY'),
    ]; // 6 — a full cast
    expect(autoSelectAfterCreate(cast, member('g', 'PET'))).toBe(false);
  });

  it('never double-selects an avatar already in the cast', () => {
    const cast = [member('a', 'CHILD')];
    expect(autoSelectAfterCreate(cast, member('a', 'CHILD'))).toBe(false);
  });
});

describe('nextArrivalPollStart', () => {
  const ids = (...list: string[]) => new Set(list);

  it('resets to null when nothing is drawing', () => {
    expect(nextArrivalPollStart(ids('x'), ids(), 1_000, 5_000)).toBeNull();
    expect(nextArrivalPollStart(ids(), ids(), null, 5_000)).toBeNull();
  });

  it('stamps now when a polling session starts', () => {
    expect(nextArrivalPollStart(ids(), ids('x'), null, 5_000)).toBe(5_000);
  });

  it('keeps the running start while the same drawings continue', () => {
    expect(nextArrivalPollStart(ids('x'), ids('x'), 1_000, 5_000)).toBe(1_000);
  });

  it('restamps when a NEW drawing appears beside a wedged one', () => {
    // Regression: avatar x wedged past the 240s cap must not starve a character
    // the parent creates afterwards — y appearing restarts the clock even though
    // x never settles (the old pending-hits-zero reset would never fire).
    const longExpired = 1_000;
    expect(nextArrivalPollStart(ids('x'), ids('x', 'y'), longExpired, 500_000)).toBe(500_000);
  });

  it('does not restamp when a drawing settles while others continue', () => {
    expect(nextArrivalPollStart(ids('x', 'y'), ids('x'), 1_000, 5_000)).toBe(1_000);
  });
});

describe('sharedReadyStyles', () => {
  const rendition = (artStyle: string, status = 'READY', turnaroundSheetUrl: string | null = 'https://x/sheet.png') => ({
    artStyle,
    status,
    turnaroundSheetUrl,
  });

  it('intersects READY styles across the cast', () => {
    expect(
      sharedReadyStyles([
        { renditions: [rendition('vignette'), rendition('kawaii')] },
        { renditions: [rendition('vignette')] },
      ]),
    ).toEqual(['vignette']);
  });

  it('ignores PENDING and sheet-less renditions', () => {
    expect(
      sharedReadyStyles([
        { renditions: [rendition('vignette', 'PENDING'), rendition('kawaii')] },
        { renditions: [rendition('kawaii'), rendition('vignette', 'READY', null)] },
      ]),
    ).toEqual(['kawaii']);
  });

  it('empty intersection and empty cast are honest', () => {
    expect(
      sharedReadyStyles([{ renditions: [rendition('vignette')] }, { renditions: [rendition('kawaii')] }]),
    ).toEqual([]);
    expect(sharedReadyStyles([])).toEqual([]);
  });
});
