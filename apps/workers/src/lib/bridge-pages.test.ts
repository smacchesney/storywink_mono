import { describe, it, expect, afterEach } from 'vitest';
import type { StoryBridgePageResponse } from '@storywink/shared/prompts/story';
import {
  bridgePagesEnabled,
  shouldPurgeStaleBridges,
  bridgeCapForPhotoCount,
  validateBridgePages,
  planPageSequence,
  resolveBridgeAnchor,
  type AnchorCandidate,
} from './bridge-pages.js';

function makeBridge(
  afterPhotoPage: number,
  overrides: Partial<StoryBridgePageResponse> = {},
): StoryBridgePageResponse {
  return {
    afterPhotoPage,
    text: `Bridge text after page ${afterPhotoPage}`,
    illustrationNotes: null,
    scene: {
      location: 'the sandy path to the beach',
      timeOfDay: 'morning',
      action: 'marching down the path, bucket swinging',
      charactersPresent: ['char-1'],
      outfitFrom: 'previous',
      props: ['red bucket'],
    },
    ...overrides,
  };
}

const ROSTER = { photoCount: 10, rosterCharacterIds: ['char-1', 'char-2'] };

describe('bridgePagesEnabled (flag-off inertness)', () => {
  const original = process.env.BRIDGE_PAGES_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.BRIDGE_PAGES_ENABLED;
    else process.env.BRIDGE_PAGES_ENABLED = original;
  });

  it('defaults OFF when unset', () => {
    delete process.env.BRIDGE_PAGES_ENABLED;
    expect(bridgePagesEnabled()).toBe(false);
  });

  it('only the exact string "true" enables it', () => {
    process.env.BRIDGE_PAGES_ENABLED = '1';
    expect(bridgePagesEnabled()).toBe(false);
    process.env.BRIDGE_PAGES_ENABLED = 'TRUE';
    expect(bridgePagesEnabled()).toBe(false);
    process.env.BRIDGE_PAGES_ENABLED = 'true';
    expect(bridgePagesEnabled()).toBe(true);
  });
});

describe('bridgeCapForPhotoCount', () => {
  it('caps at 2 for normal books', () => {
    expect(bridgeCapForPhotoCount(10)).toBe(2);
    expect(bridgeCapForPhotoCount(21)).toBe(2);
  });

  it('shrinks against the 23-row saddle-stitch ceiling', () => {
    expect(bridgeCapForPhotoCount(22)).toBe(1);
    expect(bridgeCapForPhotoCount(23)).toBe(0);
    expect(bridgeCapForPhotoCount(30)).toBe(0); // over-limit input still safe
  });
});

describe('validateBridgePages (validate-or-drop, never throw)', () => {
  it('accepts a grounded bridge', () => {
    const { accepted, dropped } = validateBridgePages([makeBridge(3)], ROSTER);
    expect(accepted).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it('handles undefined / non-array / empty input', () => {
    expect(validateBridgePages(undefined, ROSTER).accepted).toHaveLength(0);
    expect(validateBridgePages('nope', ROSTER).accepted).toHaveLength(0);
    expect(validateBridgePages([], ROSTER).accepted).toHaveLength(0);
  });

  it('drops malformed entries (bad shape, empty text) without failing', () => {
    const { accepted, dropped } = validateBridgePages(
      [{ afterPhotoPage: 2 }, makeBridge(3, { text: '   ' }), makeBridge(4)],
      ROSTER,
    );
    expect(accepted.map((b) => b.afterPhotoPage)).toEqual([4]);
    expect(dropped.map((d) => d.reason)).toEqual(['malformed', 'malformed']);
  });

  it('drops out-of-range gaps (before first photo / past the end)', () => {
    const { accepted, dropped } = validateBridgePages(
      [makeBridge(0), makeBridge(11), makeBridge(10)], // 10 = trailing wind-down, allowed
      ROSTER,
    );
    expect(accepted.map((b) => b.afterPhotoPage)).toEqual([10]);
    expect(dropped.map((d) => d.reason).sort()).toEqual(['bad-gap', 'malformed']); // 0 fails zod min(1)
  });

  it('drops bridges naming characters outside the roster', () => {
    const rogue = makeBridge(5);
    rogue.scene = { ...rogue.scene, charactersPresent: ['char-1', 'stranger'] };
    const { accepted, dropped } = validateBridgePages([rogue], ROSTER);
    expect(accepted).toHaveLength(0);
    expect(dropped[0].reason).toBe('unknown-character');
  });

  it('drops ALL bridges when the roster is empty (identity-less book)', () => {
    const { accepted, dropped } = validateBridgePages([makeBridge(2)], {
      photoCount: 10,
      rosterCharacterIds: [],
    });
    expect(accepted).toHaveLength(0);
    expect(dropped[0].reason).toBe('no-roster');
  });

  it('allows at most one bridge per gap (first wins)', () => {
    const { accepted, dropped } = validateBridgePages([makeBridge(3), makeBridge(3)], ROSTER);
    expect(accepted).toHaveLength(1);
    expect(dropped[0].reason).toBe('duplicate-gap');
  });

  it('enforces the total cap min(2, 23 - photoCount)', () => {
    const { accepted, dropped } = validateBridgePages(
      [makeBridge(2), makeBridge(5), makeBridge(8)],
      ROSTER,
    );
    expect(accepted).toHaveLength(2);
    expect(dropped[0].reason).toBe('over-cap');

    const tight = validateBridgePages([makeBridge(2), makeBridge(5)], {
      photoCount: 22,
      rosterCharacterIds: ['char-1'],
    });
    expect(tight.accepted).toHaveLength(1); // cap = min(2, 23-22) = 1
  });
});

describe('planPageSequence (insertion + renumber)', () => {
  const photoIds = ['p1', 'p2', 'p3', 'p4'];

  it('no bridges → photos keep their positions untouched', () => {
    const plan = planPageSequence(photoIds, []);
    expect(plan.map((e) => [e.kind, e.photoPageId, e.pageNumber])).toEqual([
      ['photo', 'p1', 1],
      ['photo', 'p2', 2],
      ['photo', 'p3', 3],
      ['photo', 'p4', 4],
    ]);
  });

  it('interleaves a mid-book bridge and shifts later photos', () => {
    const plan = planPageSequence(photoIds, [makeBridge(2)]);
    expect(plan.map((e) => [e.kind, e.pageNumber])).toEqual([
      ['photo', 1],
      ['photo', 2],
      ['bridge', 3],
      ['photo', 4],
      ['photo', 5],
    ]);
    // index is always pageNumber - 1
    expect(plan.every((e) => e.index === e.pageNumber - 1)).toBe(true);
  });

  it('supports a trailing bridge after the last photo', () => {
    const plan = planPageSequence(photoIds, [makeBridge(4)]);
    expect(plan[plan.length - 1].kind).toBe('bridge');
    expect(plan[plan.length - 1].pageNumber).toBe(5);
  });

  it('two bridges land in their own gaps in reading order', () => {
    const plan = planPageSequence(photoIds, [makeBridge(3), makeBridge(1)]);
    expect(plan.map((e) => e.kind)).toEqual([
      'photo',
      'bridge',
      'photo',
      'photo',
      'bridge',
      'photo',
    ]);
    expect(plan.map((e) => e.pageNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('resolveBridgeAnchor', () => {
  const pages: AnchorCandidate[] = [
    { pageNumber: 1, source: 'PHOTO', assetUrl: 'u1' },
    { pageNumber: 2, source: 'PHOTO', assetUrl: 'u2' },
    { pageNumber: 3, source: 'BRIDGE', assetUrl: null },
    { pageNumber: 4, source: 'PHOTO', assetUrl: 'u4' },
  ];

  it('prefers the nearest PRECEDING photo page', () => {
    expect(resolveBridgeAnchor(pages, 3)?.assetUrl).toBe('u2');
  });

  it('falls back to the nearest FOLLOWING photo page', () => {
    const headBridge: AnchorCandidate[] = [
      { pageNumber: 1, source: 'BRIDGE', assetUrl: null },
      { pageNumber: 2, source: 'PHOTO', assetUrl: 'u2' },
      { pageNumber: 3, source: 'PHOTO', assetUrl: 'u3' },
    ];
    expect(resolveBridgeAnchor(headBridge, 1)?.assetUrl).toBe('u2');
  });

  it('skips photo pages without a usable asset URL', () => {
    const withGap: AnchorCandidate[] = [
      { pageNumber: 1, source: 'PHOTO', assetUrl: 'u1' },
      { pageNumber: 2, source: 'PHOTO', assetUrl: null }, // asset deleted
      { pageNumber: 3, source: 'BRIDGE', assetUrl: null },
    ];
    expect(resolveBridgeAnchor(withGap, 3)?.assetUrl).toBe('u1');
  });

  it('never anchors to another bridge; null when no photos exist', () => {
    const onlyBridges: AnchorCandidate[] = [{ pageNumber: 1, source: 'BRIDGE', assetUrl: null }];
    expect(resolveBridgeAnchor(onlyBridges, 1)).toBeNull();
  });

  it('a trailing bridge anchors to the last photo', () => {
    expect(resolveBridgeAnchor(pages, 5)?.assetUrl).toBe('u4');
  });

  describe("outfitFrom='next' (the authored outfits change AT this bridge)", () => {
    it('prefers the nearest FOLLOWING photo page', () => {
      expect(resolveBridgeAnchor(pages, 3, 'next')?.assetUrl).toBe('u4');
    });

    it('falls back to the nearest preceding photo when the bridge is after the last photo', () => {
      expect(resolveBridgeAnchor(pages, 5, 'next')?.assetUrl).toBe('u4');
    });

    it('null when no photos exist, same as the default direction', () => {
      const onlyBridges: AnchorCandidate[] = [{ pageNumber: 1, source: 'BRIDGE', assetUrl: null }];
      expect(resolveBridgeAnchor(onlyBridges, 1, 'next')).toBeNull();
    });
  });

  it("explicit outfitFrom='previous' matches the default behavior", () => {
    expect(resolveBridgeAnchor(pages, 3, 'previous')?.assetUrl).toBe('u2');
  });
});

describe('shouldPurgeStaleBridges (X6d purge gate)', () => {
  it('purges stale bridge rows on photo books', () => {
    expect(
      shouldPurgeStaleBridges('PHOTO_STORY', [{ source: 'PHOTO' }, { source: 'BRIDGE' }]),
    ).toBe(true);
  });

  it('NEVER purges avatar-story books — their pages ARE bridge-source rows', () => {
    expect(
      shouldPurgeStaleBridges('AVATAR_STORY', [{ source: 'BRIDGE' }, { source: 'BRIDGE' }]),
    ).toBe(false);
  });

  it('no bridge rows → nothing to purge', () => {
    expect(shouldPurgeStaleBridges('PHOTO_STORY', [{ source: 'PHOTO' }])).toBe(false);
    expect(shouldPurgeStaleBridges(null, [])).toBe(false);
  });
});
