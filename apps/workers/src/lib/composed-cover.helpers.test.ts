import { describe, it, expect } from 'vitest';
import {
  composedCoverEligible,
  resolveHeroAssetIds,
  starredCharacterIds,
  selectStyleAnchorPage,
} from './composed-cover.helpers.js';
import type { CharacterIdentity } from '@storywink/shared/types';

describe('composedCoverEligible (X17 A1)', () => {
  const base = {
    bookType: 'PHOTO_STORY',
    coverAssetId: null,
    coverImageUrl: null,
    artStyle: 'vignette',
  };
  it('null-cover photo book with a style is eligible', () => {
    expect(composedCoverEligible(base)).toBe(true);
  });
  it('legacy cover / existing cover / avatar / no style are not', () => {
    expect(composedCoverEligible({ ...base, coverAssetId: 'a1' })).toBe(false);
    expect(composedCoverEligible({ ...base, coverImageUrl: 'x.png' })).toBe(false);
    expect(composedCoverEligible({ ...base, bookType: 'AVATAR_STORY' })).toBe(false);
    expect(composedCoverEligible({ ...base, artStyle: null })).toBe(false);
  });
});

describe('resolveHeroAssetIds (X17 A1)', () => {
  const pages = [{ assetId: 'a1' }, { assetId: 'a2' }, { assetId: null }, { assetId: 'a4' }];
  it('keeps only heroes still on the book, order preserved, cap 3', () => {
    expect(resolveHeroAssetIds(['a4', 'gone', 'a1', 'a2', 'a4'], pages)).toEqual([
      'a4',
      'a1',
      'a2',
    ]);
  });
  it('falls back to the first photo when none survive', () => {
    expect(resolveHeroAssetIds(['gone'], pages)).toEqual(['a1']);
    expect(resolveHeroAssetIds(null, pages)).toEqual(['a1']);
  });
  it('no photos at all → empty', () => {
    expect(resolveHeroAssetIds(['a1'], [{ assetId: null }])).toEqual([]);
  });
});

describe('starredCharacterIds (X17 A1/A2)', () => {
  const identity = {
    characters: [{ characterId: 'child_1', role: 'main_child' }],
  } as unknown as CharacterIdentity;
  it('ensemble members win', () => {
    expect(
      starredCharacterIds({
        castMode: 'ensemble',
        castMemberIds: ['child_1', 'child_2'],
        starCharacterId: 'child_9',
        characterIdentity: identity,
      }),
    ).toEqual(['child_1', 'child_2']);
  });
  it('then the picked star, then the main_child guess, then empty', () => {
    expect(
      starredCharacterIds({
        castMode: 'star',
        castMemberIds: null,
        starCharacterId: 'child_2',
        characterIdentity: identity,
      }),
    ).toEqual(['child_2']);
    expect(
      starredCharacterIds({
        castMode: 'star',
        castMemberIds: null,
        starCharacterId: null,
        characterIdentity: identity,
      }),
    ).toEqual(['child_1']);
    expect(
      starredCharacterIds({
        castMode: 'star',
        castMemberIds: null,
        starCharacterId: null,
        characterIdentity: null,
      }),
    ).toEqual([]);
  });
});

describe('selectStyleAnchorPage (X17 A1)', () => {
  const pages = [
    { pageId: 'p1', pageNumber: 1, generatedImageUrl: 'r1.png' },
    { pageId: 'p2', pageNumber: 2, generatedImageUrl: 'r2.png' },
    { pageId: 'p3', pageNumber: 3, generatedImageUrl: null },
  ];
  const identity = {
    characters: [
      { characterId: 'child_1', role: 'main_child', appearsOnPages: [2] },
      { characterId: 'child_2', role: 'sibling', appearsOnPages: [1, 2] },
    ],
  } as unknown as CharacterIdentity;

  it('prefers a QC-passing page with the most starred members', () => {
    const anchor = selectStyleAnchorPage(
      pages,
      [
        { pageId: 'p1', overallScore: 9, passed: true, qcRound: 0 },
        { pageId: 'p2', overallScore: 7, passed: true, qcRound: 0 },
      ],
      ['child_1', 'child_2'],
      identity,
    );
    expect(anchor?.pageId).toBe('p2'); // 2 starred members beat a higher score
  });

  it('the latest QC round supersedes round 0', () => {
    const anchor = selectStyleAnchorPage(
      pages,
      [
        { pageId: 'p2', overallScore: 9, passed: true, qcRound: 0 },
        { pageId: 'p2', overallScore: 3, passed: false, qcRound: 1 },
        { pageId: 'p1', overallScore: 6, passed: true, qcRound: 0 },
      ],
      ['child_2'],
      identity,
    );
    expect(anchor?.pageId).toBe('p1'); // p2's round-1 fail knocks it out of the passing tier
  });

  it('no QC rows: falls back to the first rendered page; no renders: null', () => {
    expect(selectStyleAnchorPage(pages, [], [], null)?.pageId).toBe('p1');
    expect(
      selectStyleAnchorPage(
        [{ pageId: 'p3', pageNumber: 3, generatedImageUrl: null }],
        [],
        [],
        null,
      ),
    ).toBeNull();
  });
});
