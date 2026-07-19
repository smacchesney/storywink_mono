import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  avatar: { findUnique: vi.fn(), updateMany: vi.fn() },
  appEvent: { create: vi.fn() },
}));
vi.mock('../database/index.js', () => ({ default: prismaMock }));

import {
  applyClothingToIdentity,
  buildStyleTranslationRewritePrompt,
  reconcileAvatarClothing,
} from './avatar-clothing.js';

const character = {
  characterId: 'char_1',
  role: 'main_child',
  name: 'Kai',
  typicalClothing: 'blue tee and shorts',
  styleTranslation: 'Paint the blue tee with gouache.',
};

describe('applyClothingToIdentity (X15 clothing reconcile)', () => {
  it('patches a NESTED identity (identity.character) preserving the shape', () => {
    const identity = { character: { ...character }, extractedForStyle: 'vignette' };
    const out = applyClothingToIdentity(
      identity,
      'orange tee',
      'Paint the orange tee with gouache.',
    );
    expect(out.character.typicalClothing).toBe('orange tee');
    expect(out.character.styleTranslation).toBe('Paint the orange tee with gouache.');
    expect(out.extractedForStyle).toBe('vignette');
    expect('typicalClothing' in out).toBe(false);
    // input untouched
    expect(identity.character.typicalClothing).toBe('blue tee and shorts');
  });

  it('patches a FLAT identity preserving the shape', () => {
    const identity = { ...character };
    const out = applyClothingToIdentity(identity, 'orange tee', 'Paint the orange tee.');
    expect(out.typicalClothing).toBe('orange tee');
    expect(out.styleTranslation).toBe('Paint the orange tee.');
    expect('character' in out).toBe(false);
  });

  it('keeps the existing styleTranslation when no rewrite is supplied', () => {
    const identity = { character: { ...character } };
    const out = applyClothingToIdentity(identity, 'orange tee', null);
    expect(out.character.typicalClothing).toBe('orange tee');
    expect(out.character.styleTranslation).toBe('Paint the blue tee with gouache.');
  });
});

describe('buildStyleTranslationRewritePrompt', () => {
  it('carries both the original prose and the observed clothing verbatim', () => {
    const p = buildStyleTranslationRewritePrompt('Paint the blue tee.', 'orange raglan tee');
    expect(p).toContain('Paint the blue tee.');
    expect(p).toContain('orange raglan tee');
  });
});

describe('reconcileAvatarClothing orchestration (all-or-nothing, non-fatal)', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
  const updatedAt = new Date('2026-07-19T00:00:00Z');
  const storedAvatar = {
    id: 'av1',
    updatedAt,
    identity: { character: { ...character }, extractedForStyle: 'vignette' },
  };
  const openaiWith = (outputText: string | undefined) =>
    ({ responses: { create: vi.fn(async () => ({ output_text: outputText })) } }) as never;

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.avatar.findUnique.mockResolvedValue(storedAvatar);
    prismaMock.avatar.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.appEvent.create.mockResolvedValue({});
  });

  const params = (openai: never) => ({
    openai,
    avatarId: 'av1',
    userId: 'u1',
    observedClothing: 'orange raglan tee',
    logger,
  });

  it('happy path: persists via compare-and-set on the read updatedAt, with both fields patched', async () => {
    await reconcileAvatarClothing(
      params(
        openaiWith(JSON.stringify({ styleTranslation: 'Paint the orange tee with gouache.' })),
      ),
    );
    expect(prismaMock.avatar.updateMany).toHaveBeenCalledTimes(1);
    const arg = prismaMock.avatar.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'av1', updatedAt });
    expect(arg.data.identity.character.typicalClothing).toBe('orange raglan tee');
    expect(arg.data.identity.character.styleTranslation).toBe('Paint the orange tee with gouache.');
  });

  it('does NOT persist when the rewrite returns empty (all-or-nothing)', async () => {
    await reconcileAvatarClothing(params(openaiWith(JSON.stringify({ styleTranslation: '  ' }))));
    expect(prismaMock.avatar.updateMany).not.toHaveBeenCalled();
  });

  it('does NOT persist when the rewrite balloons past the length bound', async () => {
    await reconcileAvatarClothing(
      params(openaiWith(JSON.stringify({ styleTranslation: 'x'.repeat(5000) }))),
    );
    expect(prismaMock.avatar.updateMany).not.toHaveBeenCalled();
  });

  it('never throws when the rewrite call rejects, and persists nothing', async () => {
    const openai = {
      responses: { create: vi.fn(async () => Promise.reject(new Error('boom'))) },
    } as never;
    await expect(reconcileAvatarClothing(params(openai))).resolves.toBeUndefined();
    expect(prismaMock.avatar.updateMany).not.toHaveBeenCalled();
  });

  it('skips silently when the avatar has no identity', async () => {
    prismaMock.avatar.findUnique.mockResolvedValue({ id: 'av1', updatedAt, identity: null });
    const openai = openaiWith('unused');
    await reconcileAvatarClothing(params(openai));
    expect(prismaMock.avatar.updateMany).not.toHaveBeenCalled();
    expect((openai as { responses: { create: unknown } }).responses.create).not.toHaveBeenCalled();
  });

  it('emits no telemetry when the compare-and-set loses (stale read)', async () => {
    prismaMock.avatar.updateMany.mockResolvedValue({ count: 0 });
    await reconcileAvatarClothing(
      params(openaiWith(JSON.stringify({ styleTranslation: 'Paint the orange tee.' }))),
    );
    expect(prismaMock.appEvent.create).not.toHaveBeenCalled();
  });
});
