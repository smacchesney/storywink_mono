'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import RoughUnderline from '@/components/ui/rough-underline';

interface AnimatedHeroTextProps {
  /** Sentence fragment before the rotating word (carries its own spacing). */
  lead?: string;
  /** Sentence fragment after the rotating word, rendered flush against it. */
  trail?: string;
  /** Words that rotate in the coral slot. */
  rotatingWords?: string[];
  /** ms each word stays before the next. */
  interval?: number;
  className?: string;
}

/**
 * Hero headline with a single inline rotating word.
 *
 * The slot is an `inline-grid` stack: every word is always mounted in
 * `grid-area: 1/1`, so the grid's intrinsic width is the widest word —
 * resolved by the browser at first paint, SSR-safe, and recomputed for free
 * on resize and font load. No sizers, no measurement, no width tween, so
 * Excalifont's late load can never snap the layout. Rotation animates only
 * opacity and translateY. Neighbouring copy (including a flush trail like
 * the Japanese 「です。」) never moves.
 *
 * Spacing contract: `lead` and `trail` render verbatim with no injected
 * spaces — the English catalog carries a trailing space in `lead`, Japanese
 * carries none. Screen readers get one static sentence using word 1; the
 * animated copy is `aria-hidden`.
 */
function AnimatedHeroText({
  lead = '',
  trail = '',
  rotatingWords = ['Hero', 'Princess', 'Adventurer', 'Explorer', 'Firefighter'],
  interval = 2600,
  className = '',
}: AnimatedHeroTextProps) {
  const words = rotatingWords.length ? rotatingWords : ['Hero'];
  const [index, setIndex] = useState(0);
  const prefersReduced = useReducedMotion();
  const slotRef = useRef<HTMLSpanElement>(null);
  // Width is observed ONLY to size the static underline; it never feeds back
  // into the text layout.
  const [slotWidth, setSlotWidth] = useState(0);

  useEffect(() => {
    const el = slotRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setSlotWidth(el.offsetWidth));
    observer.observe(el);
    setSlotWidth(el.offsetWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (prefersReduced || words.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words.length, interval, prefersReduced]);

  // Rotation is strictly sequential, so the word leaving upward is always
  // the previous index; every other hidden word waits below the baseline.
  const prevIndex = (index - 1 + words.length) % words.length;

  return (
    <h1
      className={`text-3xl leading-[1.12] font-bold tracking-tight text-balance text-ink sm:text-4xl md:text-5xl lg:text-[3.4rem] ${className}`}
    >
      <span className="sr-only">
        {lead}
        {words[0]}
        {trail}
      </span>
      <span aria-hidden="true">
        {lead}
        <span
          ref={slotRef}
          className="relative inline-grid justify-items-center align-baseline font-playful whitespace-nowrap text-coral"
        >
          {words.map((word, i) => {
            const isCurrent = i === index;
            const isLeaving = i === prevIndex && !isCurrent;
            return (
              <span
                key={`${word}-${i}`}
                className={`col-start-1 row-start-1 whitespace-nowrap transition-[opacity,transform] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                  isCurrent
                    ? 'translate-y-0 opacity-100'
                    : `pointer-events-none opacity-0 ${
                        isLeaving ? '-translate-y-[0.32em]' : 'translate-y-[0.32em]'
                      }`
                }`}
              >
                {word}
              </span>
            );
          })}
          {/* Static coral underline spanning the full slot width — drawn at
              the measured width, never transform-stretched, so the
              hand-drawn stroke keeps its character. */}
          {slotWidth > 0 && (
            <span className="pointer-events-none absolute top-full left-1/2 -mt-[0.08em] -translate-x-1/2">
              <RoughUnderline
                width={slotWidth}
                color="var(--coral-primary)"
                strokeWidth={3}
                roughness={1.8}
                extensionFactor={1}
              />
            </span>
          )}
        </span>
        {trail}
      </span>
    </h1>
  );
}

export { AnimatedHeroText };
