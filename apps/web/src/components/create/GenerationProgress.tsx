'use client';

import React, { useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BookStatus } from '@prisma/client';
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave';
import { Storydust, CLOUD, CLOUD_VIEWBOX } from '@/components/ui/storydust';
import { MASCOT_CAT_FLOATING } from '@/lib/mascots';
import { useBookStatus } from '@/hooks/useBookStatus';
import { resolveProgressHeadline } from '@/components/create/progress-headline';
import BookIssueBanner from '@/components/create/BookIssueBanner';
import { CREATE_DISCOVERY_FLAG } from '@/lib/discovery-client';

interface GenerationProgressProps {
  bookId: string;
  /** When true, a STORY_READY status routes to the review page. */
  reviewFirst?: boolean;
  /**
   * When provided, called on COMPLETED/PARTIAL instead of routing to the
   * preview page — used when the preview itself hosts this screen and just
   * needs to refresh in place.
   */
  onComplete?: (status: BookStatus) => void;
}

// Gentle stall timeout — not an error, just "check back later". Measured
// from the last observed progress change, never from mount: the story stage
// writes in one batch and can legitimately sit quiet through QC + a regen,
// so an absolute timer would fire inside a healthy run.
const TIMEOUT_MS = 8 * 60 * 1000;

/**
 * The full-screen "we're making your book" state that follows the setup tap.
 * It reads status from the shared polling hook, narrates each phase in the
 * brand's Kai-and-sparkles language, and routes away on its own once the
 * book is done. A parent can leave — the copy says so.
 */
export function GenerationProgress({ bookId, reviewFirst, onComplete }: GenerationProgressProps) {
  const t = useTranslations('progress');
  const router = useRouter();

  const {
    status,
    generationPhase,
    bookType,
    childName,
    totalPages,
    pagesWithText,
    pagesWithIllustrations,
    isTimedOut,
    restart,
  } = useBookStatus(bookId, { intervalMs: 5000, timeoutMs: TIMEOUT_MS });

  // Tab title: while we work, the tab strip says so; on completion it becomes
  // a free notification channel for a parent who switched tabs.
  const originalTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (originalTitleRef.current == null) {
      originalTitleRef.current = document.title;
    }
    document.title = t('tabWorking');
    return () => {
      if (originalTitleRef.current != null) {
        document.title = originalTitleRef.current;
      }
    };
  }, [t]);

  // Move on when the book is done. If the tab is hidden, flip the title and
  // wait for the parent to come back — a background tab can't watch the book
  // open, but its title can announce that it's ready.
  useEffect(() => {
    if (status !== BookStatus.COMPLETED && status !== BookStatus.PARTIAL) return undefined;
    const proceed = () => {
      if (onComplete) {
        onComplete(status);
      } else {
        // ?reveal=1 only bridges the preview's data-loading flash with a warm
        // screen — the reveal itself is gated server-side on firstViewedAt.
        const suffix = status === BookStatus.COMPLETED ? '?reveal=1' : '';
        router.push(`/book/${bookId}/preview${suffix}`);
      }
    };
    if (document.hidden) {
      document.title = t('tabReady');
      const onVisible = () => {
        if (!document.hidden) proceed();
      };
      document.addEventListener('visibilitychange', onVisible);
      return () => document.removeEventListener('visibilitychange', onVisible);
    }
    proceed();
    return undefined;
  }, [status, onComplete, bookId, router, t]);

  // Review-first books route to review the moment the story is ready.
  useEffect(() => {
    if (status === BookStatus.STORY_READY && reviewFirst) {
      router.push(`/create/review?bookId=${bookId}`);
    }
  }, [status, reviewFirst, bookId, router]);

  // On the auto-chain path STORY_READY is transient — UNLESS the grace
  // window (X17 B4) is holding it on purpose: then the peek IS the
  // destination, immediately. Without the flag, the legacy 15s stall
  // fallback stands. Config note: the flip runbook sets STORY_PEEK_GRACE_MS
  // on workers wherever this client flag is on; if workers run grace-less,
  // a mid-chain STORY_READY blip can flash the peek for one poll tick —
  // the review poll routes straight back, so it self-heals.
  useEffect(() => {
    if (status !== BookStatus.STORY_READY || reviewFirst) return;
    if (CREATE_DISCOVERY_FLAG) {
      router.push(`/create/review?bookId=${bookId}&peek=1`);
      return;
    }
    const timer = setTimeout(() => {
      router.push(`/create/review?bookId=${bookId}`);
    }, 15000);
    return () => clearTimeout(timer);
  }, [status, reviewFirst, bookId, router]);

  // Failure surface: swap the shimmer for the retry banner in place.
  const isFailed = status === BookStatus.FAILED;

  // Honest narration: the workers write generationPhase at real transitions
  // and the resolver maps it to a headline; a null/stale phase degrades to
  // the status-only copy this screen shipped with.
  const headlineSpec = resolveProgressHeadline({
    status,
    generationPhase,
    totalPages,
    pagesWithText,
    pagesWithIllustrations,
    childName,
    bookType,
  });
  const headline = t(headlineSpec.key, headlineSpec.values);

  // Monotone bar: finalize-QC nulls images on the pages it re-renders, which
  // would visibly yank the bar backwards right when we do extra quality work.
  // Hold the high-water mark instead.
  const maxFractionRef = useRef(0);
  const rawFraction =
    status === BookStatus.ILLUSTRATING && totalPages > 0
      ? Math.min(pagesWithIllustrations / totalPages, 1)
      : null;
  if (rawFraction != null && rawFraction > maxFractionRef.current) {
    maxFractionRef.current = rawFraction;
  }
  const illustrationFraction = rawFraction != null ? maxFractionRef.current : null;

  return (
    <div className="bg-waiting fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden px-6">
      {/* Scenery: two clouds in the top corners + drifting star dust. */}
      <svg
        viewBox={CLOUD_VIEWBOX}
        fill="currentColor"
        aria-hidden="true"
        className="cloud-drift-slow pointer-events-none absolute -top-4 -left-10 w-48 text-white/50 md:w-64"
        style={{ willChange: 'transform' }}
      >
        <path d={CLOUD} />
      </svg>
      <svg
        viewBox={CLOUD_VIEWBOX}
        fill="currentColor"
        aria-hidden="true"
        className="cloud-drift-slower pointer-events-none absolute -top-2 -right-12 w-40 text-white/50 md:w-56"
        style={{ willChange: 'transform' }}
      >
        <path d={CLOUD} />
      </svg>
      <Storydust variant="dust" />

      <div
        className="wink-float mb-10"
        style={{
          willChange: 'transform',
          filter: 'drop-shadow(0 8px 16px rgba(247, 108, 94, 0.15))',
        }}
      >
        <Image
          src={MASCOT_CAT_FLOATING}
          alt={t('mascotAlt')}
          width={200}
          height={200}
          className="h-28 w-28 object-contain md:h-36 md:w-36"
          priority
        />
      </div>

      {isFailed ? (
        <div className="w-full max-w-sm">
          {/* restart() resumes polling; the banner unmounts once the status
              clears, which is what resets its "trying again" spinner. */}
          <BookIssueBanner bookId={bookId} status={BookStatus.FAILED} onRetryStarted={restart} />
        </div>
      ) : isTimedOut ? (
        <div className="flex flex-col items-center text-center">
          <p className="max-w-xs font-playful text-lg font-semibold text-gray-700 md:text-xl">
            {t('stillWorking')}
          </p>
          <button
            onClick={() => router.push('/library')}
            className="mt-6 rounded-full bg-coral px-6 py-2.5 font-playful text-white shadow-sm transition-colors hover:bg-coral/90"
          >
            {t('goToLibrary')}
          </button>
        </div>
      ) : (
        <>
          <div className="isolate mb-6 text-center">
            <TextShimmerWave
              className="font-playful text-2xl font-semibold [--base-color:#374151] [--base-gradient-color:var(--coral-primary)] md:text-3xl"
              duration={1.2}
              spread={1}
              zDistance={1}
              scaleDistance={1.05}
              rotateYDistance={15}
            >
              {headline}
            </TextShimmerWave>
          </div>

          {/* The pencil draws the wait: looping while the story is written,
              then tracking real page progress once illustration starts. */}
          <Storydust variant="pencil" size="hero" progress={illustrationFraction ?? undefined} />

          <p className="mt-8 max-w-xs text-center font-playful text-xs text-gray-500">
            {t('usuallyReady')}
          </p>
          <p className="mt-2 max-w-xs text-center font-playful text-xs text-coral">
            {t('canLeave')}
          </p>
        </>
      )}
    </div>
  );
}

export default GenerationProgress;
