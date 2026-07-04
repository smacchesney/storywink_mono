"use client";

import React, { useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { BookStatus } from '@prisma/client';
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave';
import { useBookStatus } from '@/hooks/useBookStatus';
import BookIssueBanner from '@/components/create/BookIssueBanner';

interface GenerationProgressProps {
  bookId: string;
  /** When true, a STORY_READY status routes to the review page. */
  reviewFirst?: boolean;
}

const MASCOT_SRC =
  'https://res.cloudinary.com/storywink/image/upload/v1772291377/Screenshot_2026-02-28_at_10.57.58_PM_mijhwv.png';

// 8-minute gentle timeout — not an error, just "check back later".
const TIMEOUT_MS = 8 * 60 * 1000;

const Sparkle = ({
  size,
  top,
  left,
  delay,
  duration,
}: {
  size: number;
  top: string;
  left: string;
  delay: number;
  duration: number;
}) => (
  <div
    className="absolute pointer-events-none"
    style={{
      top,
      left,
      width: size,
      height: size,
      opacity: 0.12,
      animation: `sparkle-drift ${duration}s ease-in-out ${delay}s infinite`,
    }}
  >
    <svg viewBox="0 0 24 24" fill="#F76C5E" className="w-full h-full">
      <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7L12 17l-6.3 4 2.3-7-6-4.6h7.6L12 2z" />
    </svg>
  </div>
);

const ProgressDots = () => (
  <div className="flex gap-1.5 mt-4">
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        className="w-1.5 h-1.5 rounded-full bg-[#F76C5E]"
        style={{
          opacity: 0.4,
          animation: `pulse-dot 1.4s ease-in-out ${i * 0.2}s infinite`,
        }}
      />
    ))}
  </div>
);

/**
 * The full-screen "we're making your book" state that follows the setup tap.
 * It reads status from the shared polling hook, narrates each phase in the
 * brand's Kai-and-sparkles language, and routes away on its own once the
 * book is done. A parent can leave — the copy says so.
 */
export function GenerationProgress({ bookId, reviewFirst }: GenerationProgressProps) {
  const t = useTranslations('progress');
  const router = useRouter();

  const { status, totalPages, pagesWithText, pagesWithIllustrations, isTimedOut } =
    useBookStatus(bookId, { intervalMs: 5000, timeoutMs: TIMEOUT_MS });

  // Route away on terminal, non-failure states.
  useEffect(() => {
    if (status === BookStatus.COMPLETED || status === BookStatus.PARTIAL) {
      router.push(`/book/${bookId}/preview`);
    } else if (status === BookStatus.STORY_READY && reviewFirst) {
      router.push(`/create/review?bookId=${bookId}`);
    }
  }, [status, reviewFirst, bookId, router]);

  // On the auto-chain path STORY_READY is transient (seconds). If it PERSISTS,
  // the book is genuinely parked there — reviewFirst was chosen in a previous
  // session (the local prop is lost on reload) or the auto-chain failed and
  // the worker reverted. Either way review is the right home; a grace timer
  // avoids hijacking the momentary STORY_READY blip mid-chain.
  useEffect(() => {
    if (status !== BookStatus.STORY_READY || reviewFirst) return;
    const timer = setTimeout(() => {
      router.push(`/create/review?bookId=${bookId}`);
    }, 15000);
    return () => clearTimeout(timer);
  }, [status, reviewFirst, bookId, router]);

  // Failure surface: swap the shimmer for the retry banner in place.
  const isFailed = status === BookStatus.FAILED;

  const headline = (() => {
    if (status === BookStatus.ILLUSTRATING) {
      if (pagesWithIllustrations === 0 || totalPages === 0) {
        return t('gettingCharacters');
      }
      return t('illustratingPage', {
        current: Math.min(pagesWithIllustrations + 1, totalPages),
        total: totalPages,
      });
    }
    // GENERATING (default) — reading vs writing depends on whether text landed.
    if (pagesWithText > 0) return t('writingStory');
    return t('readingPhotos');
  })();

  const illustrationFraction =
    status === BookStatus.ILLUSTRATING && totalPages > 0
      ? Math.min(pagesWithIllustrations / totalPages, 1)
      : null;

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center z-50 overflow-hidden px-6"
      style={{
        background:
          'radial-gradient(ellipse at 50% 30%, #FFF9F5 0%, #FFFBF5 50%, #FFF5F0 100%)',
      }}
    >
      <style jsx>{`
        @keyframes sparkle-drift {
          0%,
          100% {
            transform: translateY(0) rotate(0deg);
            opacity: 0.08;
          }
          50% {
            transform: translateY(-12px) rotate(15deg);
            opacity: 0.15;
          }
        }
        @keyframes float {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-6px);
          }
        }
        @keyframes pulse-dot {
          0%,
          100% {
            opacity: 0.3;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.2);
          }
        }
        @keyframes bar-fill {
          from {
            width: 0%;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes sparkle-drift {
            0%,
            100% {
              transform: none;
              opacity: 0.1;
            }
          }
          @keyframes float {
            0%,
            100% {
              transform: none;
            }
          }
          @keyframes pulse-dot {
            0%,
            100% {
              opacity: 0.5;
              transform: none;
            }
          }
        }
      `}</style>

      <Sparkle size={16} top="12%" left="8%" delay={0} duration={25} />
      <Sparkle size={12} top="18%" left="85%" delay={3} duration={28} />
      <Sparkle size={14} top="72%" left="12%" delay={6} duration={22} />
      <Sparkle size={10} top="65%" left="88%" delay={9} duration={30} />
      <Sparkle size={13} top="85%" left="25%" delay={4} duration={26} />

      <div
        className="mb-10"
        style={{
          animation: 'float 3s ease-in-out infinite',
          filter: 'drop-shadow(0 8px 16px rgba(247, 108, 94, 0.15))',
        }}
      >
        <Image
          src={MASCOT_SRC}
          alt={t('mascotAlt')}
          width={200}
          height={200}
          className="w-28 h-28 md:w-36 md:h-36 object-contain"
          priority
        />
      </div>

      {isFailed ? (
        <div className="w-full max-w-sm">
          <BookIssueBanner bookId={bookId} status={BookStatus.FAILED} />
        </div>
      ) : isTimedOut ? (
        <div className="flex flex-col items-center text-center">
          <p className="text-lg md:text-xl font-semibold font-playful text-gray-700 max-w-xs">
            {t('stillWorking')}
          </p>
          <button
            onClick={() => router.push('/library')}
            className="mt-6 rounded-full bg-[#F76C5E] px-6 py-2.5 text-white font-playful shadow-sm hover:bg-[#F76C5E]/90 transition-colors"
          >
            {t('goToLibrary')}
          </button>
        </div>
      ) : (
        <>
          <div className="isolate mb-6 text-center">
            <TextShimmerWave
              className="text-2xl md:text-3xl font-semibold font-playful [--base-color:#374151] [--base-gradient-color:#F76C5E]"
              duration={1.2}
              spread={1}
              zDistance={1}
              scaleDistance={1.05}
              rotateYDistance={15}
            >
              {headline}
            </TextShimmerWave>
          </div>

          {illustrationFraction != null ? (
            <div className="w-48 h-1.5 rounded-full bg-[#F76C5E]/15 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#F76C5E] transition-[width] duration-700 ease-out"
                style={{ width: `${Math.round(illustrationFraction * 100)}%` }}
              />
            </div>
          ) : (
            <ProgressDots />
          )}

          <p className="text-xs text-[#F76C5E] font-playful mt-8 text-center max-w-xs">
            {t('canLeave')}
          </p>
        </>
      )}
    </div>
  );
}

export default GenerationProgress;
