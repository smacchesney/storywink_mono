import { describe, it, expect, vi } from 'vitest';
import { persistStoryQc } from './story-qc-persist.js';

const entry = {
  bookId: 'b1',
  bookType: 'PHOTO',
  language: 'en',
  round: 0,
  passed: false,
  scores: { arcCoherence: 5 },
  feedback: '1. Arc coherence scored 5/10',
  targetedRewrites: 0,
};

describe('persistStoryQc', () => {
  it('writes one StoryQcResult row', async () => {
    const create = vi.fn().mockResolvedValue({});
    await persistStoryQc({ storyQcResult: { create } } as never, entry);
    expect(create).toHaveBeenCalledWith({ data: entry });
  });

  it('never throws when the write fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db down'));
    await expect(
      persistStoryQc({ storyQcResult: { create } } as never, entry),
    ).resolves.toBeUndefined();
  });
});
