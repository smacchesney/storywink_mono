/**
 * STORY QC PERSISTENCE (X16 W1): one StoryQcResult row per QC evaluation.
 * Telemetry writes must never fail a story job — swallow every error.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

export interface StoryQcEntry {
  bookId: string;
  bookType: string;
  language: string;
  round: number;
  passed: boolean;
  scores: Record<string, unknown>;
  feedback: string | null;
  targetedRewrites: number;
}

export async function persistStoryQc(
  prisma: Pick<PrismaClient, 'storyQcResult'>,
  entry: StoryQcEntry,
): Promise<void> {
  try {
    // `scores` is a Prisma Json column — its InputJsonValue typing rejects a
    // plain Record, so cast the payload at the write boundary.
    await prisma.storyQcResult.create({
      data: entry as Prisma.StoryQcResultUncheckedCreateInput,
    });
  } catch {
    // Telemetry only — the job continues on a failed write.
  }
}
