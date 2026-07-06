'use client';

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { coolifyImageUrl } from '@storywink/shared';
import { STAR5 } from '@/components/ui/storydust';
import { MASCOT_CATS_SITTING } from '@/lib/mascots';

// Sitting cats — the ending mascot doubles as the stand-in face for older
// books that never got a painted cover.
const FALLBACK_MASCOT_URL = MASCOT_CATS_SITTING;

interface RevealOverlayProps {
  /** The book's painted cover (Book.coverImageUrl); mascot fallback when missing. */
  coverImageUrl?: string | null;
  childName?: string | null;
  bookTitle?: string | null;
  /** Called after the fade-out finishes — the parent unmounts the overlay. */
  onOpen: () => void;
}

/**
 * The first-open moment: ten minutes of waiting resolves into the cover
 * rising in on a warm gradient, once per book (gated on Book.firstViewedAt
 * by the preview page). Restrained by design — one sparkle beat, a single
 * rise-and-settle, no confetti. The parent turning the first page themselves
 * is the unwrapping; this overlay just hands them the gift.
 */
export function RevealOverlay({ coverImageUrl, childName, bookTitle, onOpen }: RevealOverlayProps) {
  const t = useTranslations('reveal');
  const [isClosing, setIsClosing] = useState(false);

  const prefersReducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    []
  );

  const name = childName?.trim() || bookTitle?.trim() || null;

  const handleOpen = () => {
    if (isClosing) return;
    setIsClosing(true);
    // Let the fade play, then hand back to the flipbook underneath.
    window.setTimeout(onOpen, prefersReducedMotion ? 0 : 300);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('ready')}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden px-6"
      style={{
        background:
          'radial-gradient(ellipse at 50% 30%, #FFF9F5 0%, #FFFBF5 50%, #FFF5F0 100%)',
        opacity: isClosing ? 0 : 1,
        transition: prefersReducedMotion ? 'none' : 'opacity 300ms ease-out',
      }}
    >
      <style jsx>{`
        @keyframes reveal-rise {
          from {
            opacity: 0;
            transform: translateY(28px) scale(0.96);
          }
          70% {
            opacity: 1;
            transform: translateY(-4px) scale(1.01);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes reveal-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes reveal-sparkle {
          0% {
            opacity: 0;
            transform: scale(0.6) rotate(0deg);
          }
          45% {
            opacity: 0.5;
            transform: scale(1.1) rotate(12deg);
          }
          100% {
            opacity: 0.18;
            transform: scale(1) rotate(15deg);
          }
        }
        .reveal-cover {
          animation: reveal-rise 600ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .reveal-copy {
          animation: reveal-fade 500ms ease-out 350ms both;
        }
        .reveal-sparkle {
          animation: reveal-sparkle 900ms ease-out both;
        }
        @media (prefers-reduced-motion: reduce) {
          .reveal-cover,
          .reveal-copy {
            animation: reveal-fade 300ms ease-out both;
          }
          .reveal-sparkle {
            animation: none;
            opacity: 0.15;
          }
        }
      `}</style>

      {/* One sparkle beat — settles, never loops. */}
      {[
        { size: 18, top: '16%', left: '14%', delay: 200 },
        { size: 14, top: '22%', left: '82%', delay: 350 },
        { size: 12, top: '74%', left: '20%', delay: 500 },
      ].map((s, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="reveal-sparkle absolute pointer-events-none"
          style={{
            top: s.top,
            left: s.left,
            width: s.size,
            height: s.size,
            animationDelay: `${s.delay}ms`,
          }}
        >
          <svg viewBox="0 0 24 24" fill="var(--coral-primary)" className="w-full h-full">
            <path d={STAR5} />
          </svg>
        </div>
      ))}

      <div
        className="reveal-cover relative w-56 h-56 md:w-72 md:h-72 rounded-2xl overflow-hidden bg-white"
        style={{ boxShadow: '0 18px 40px rgba(247, 108, 94, 0.22)' }}
      >
        {coverImageUrl ? (
          <Image
            src={coolifyImageUrl(coverImageUrl)}
            alt={bookTitle || t('ready')}
            fill
            sizes="(max-width: 768px) 224px, 288px"
            className="object-cover"
            priority
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[#FFFBF5]">
            <Image
              src={FALLBACK_MASCOT_URL}
              alt=""
              width={200}
              height={200}
              className="w-2/3 h-auto object-contain"
              priority
            />
          </div>
        )}
      </div>

      <div className="reveal-copy flex flex-col items-center text-center mt-8">
        <p className="text-2xl md:text-3xl font-semibold font-playful text-gray-800">
          {t('ready')}
        </p>
        <p className="mt-2 text-sm md:text-base text-gray-500 font-playful max-w-xs">
          {name ? t('madeFor', { name }) : t('readyPlain')}
        </p>
        <button
          onClick={handleOpen}
          autoFocus
          className="mt-7 rounded-full bg-coral px-8 py-3 text-white font-playful text-base shadow-sm hover:bg-coral/90 transition-colors"
        >
          {t('open')}
        </button>
      </div>
    </div>
  );
}

export default RevealOverlay;
