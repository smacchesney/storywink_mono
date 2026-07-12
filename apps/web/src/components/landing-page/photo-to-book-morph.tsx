'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import StorybookFrame from '@/components/ui/storybook-frame';
import { cn } from '@/lib/utils';
import { ExampleBook, getMorphFrameUrls } from './example-books-data';

/**
 * A genuine original-photo → generated-book pair. Supplied by the owner the
 * day the original photos are cleared; never fabricate one from stock or
 * stand-in imagery.
 */
export interface MorphPair {
  photoUrl: string;
  bookImageUrl: string;
  alt: string;
}

interface PhotoToBookMorphProps {
  book: ExampleBook;
  /**
   * Real photo→book pairs. When absent (day one), the card falls back to
   * crossfading the real cover → a real interior page of the same book.
   */
  pairs?: MorphPair[];
  /** Tapping the card opens this book in the example-book overlay. */
  onOpen: () => void;
  className?: string;
}

const HOLD_MS = 4000;
const FADE_MS = 900;

/**
 * The hero morph card: real artwork crossfading inside a hand-drawn
 * storybook frame. Reserved aspect-ratio box, zero CLS. Reduced motion gets
 * a static side-by-side pair joined by a hand-drawn arrow.
 */
export function PhotoToBookMorph({ book, pairs, onOpen, className }: PhotoToBookMorphProps) {
  const t = useTranslations('landing');

  const frames = useMemo(() => {
    if (pairs && pairs.length > 0) {
      return pairs.flatMap((pair) => [
        { src: pair.photoUrl, alt: pair.alt },
        { src: pair.bookImageUrl, alt: pair.alt },
      ]);
    }
    return getMorphFrameUrls(book).map((src, i) => ({
      src,
      alt: i === 0 ? book.coverAlt : t('morphPageAlt', { title: book.title }),
    }));
  }, [pairs, book, t]);

  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (frames.length < 2) return;
    // Client-only check — the reduced-motion variant swap itself is pure CSS
    // (motion-reduce classes) so SSR and client always render the same tree.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setFrameIndex((i) => (i + 1) % frames.length), HOLD_MS + FADE_MS);
    return () => clearInterval(id);
  }, [frames.length]);

  const caption = pairs && pairs.length > 0 ? t('morphCaption') : t('morphCaptionFallback');

  if (frames.length === 0) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('readBookAria', { title: book.title })}
      className={cn(
        'group mx-auto block w-full max-w-[420px] cursor-pointer rounded-lg focus-visible:ring-2 focus-visible:ring-[var(--coral-primary)] focus-visible:ring-offset-2 focus-visible:outline-none',
        className,
      )}
    >
      <StorybookFrame className="w-full transition-transform duration-300 group-hover:-translate-y-1 motion-reduce:transition-none">
        {/* Static pair with a hand-drawn arrow — shown only under
            prefers-reduced-motion (CSS toggle, so SSR markup never varies). */}
        <div className="hidden items-center gap-2 motion-reduce:grid motion-reduce:grid-cols-[1fr_auto_1fr]">
          <div className="relative aspect-square w-full overflow-hidden rounded-md">
            <Image
              src={frames[0].src}
              alt={frames[0].alt}
              fill
              sizes="(max-width: 1024px) 45vw, 200px"
              className="object-cover"
            />
          </div>
          <svg
            viewBox="0 0 48 24"
            className="w-8 text-coral"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 14 C 13 9, 27 9, 42 12" />
            <path d="M33 5 L 43 12 L 32 17" />
          </svg>
          {frames[1] && (
            <div className="relative aspect-square w-full overflow-hidden rounded-md">
              <Image
                src={frames[1].src}
                alt={frames[1].alt}
                fill
                sizes="(max-width: 1024px) 45vw, 200px"
                className="object-cover"
              />
            </div>
          )}
        </div>

        {/* Crossfading frames — hidden under prefers-reduced-motion. */}
        <div className="relative aspect-square w-full overflow-hidden rounded-md motion-reduce:hidden">
          {frames.map((frame, i) => (
            <Image
              key={`${frame.src}-${i}`}
              src={frame.src}
              alt={frame.alt}
              fill
              sizes="(max-width: 1024px) 90vw, 420px"
              priority={i === 0}
              className={cn(
                'object-cover transition-opacity ease-in-out',
                i === frameIndex ? 'opacity-100' : 'opacity-0',
              )}
              style={{ transitionDuration: `${FADE_MS}ms` }}
            />
          ))}
        </div>
      </StorybookFrame>
      <p className="mt-3 text-center font-playful text-base text-ink-soft md:text-lg">{caption}</p>
    </button>
  );
}

export default PhotoToBookMorph;
