'use client';

import React from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  STRIP_FACES_AT_MS,
  STRIP_READING_AT_MS,
  stripLineKey,
  type StripPhase,
} from '@/components/create/setup/strip-phase';

const MASCOT_SRC = '/images/mascot/kai the dino writing.png';

interface LibrarianStripProps {
  phase: StripPhase;
  /** How many capture questions the sheet is currently showing. */
  questionCount: number;
}

/**
 * The fixed-height "our librarian is reading your photos" row. Narrates the
 * perception pass with staged lines, bounces once when questions arrive, and
 * settles into a quiet handoff line when perception is slow or failed. Never
 * collapses once mounted — it only dims — so nothing below it ever shifts.
 */
export function LibrarianStrip({ phase, questionCount }: LibrarianStripProps) {
  const t = useTranslations('setup');
  const reducedMotion = useReducedMotion() ?? false;

  // Staged reading lines, timed from the moment the strip starts reading.
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (phase !== 'reading') return;
    setElapsed(0);
    const t1 = setTimeout(() => setElapsed(STRIP_FACES_AT_MS), STRIP_FACES_AT_MS);
    const t2 = setTimeout(
      () => setElapsed(STRIP_READING_AT_MS),
      STRIP_READING_AT_MS,
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [phase]);

  const lineKey = stripLineKey(phase, elapsed, questionCount);
  if (phase === 'hidden' || !lineKey) return null;

  const reading = phase === 'reading';
  const arrived = phase === 'arrived' || phase === 'arrivedQuiet';

  return (
    <div
      className={cn(
        'flex h-11 shrink-0 items-center gap-2.5 rounded-2xl bg-coral/5 px-3 transition-opacity duration-300',
        !reading && 'opacity-60',
      )}
    >
      <motion.div
        className="shrink-0"
        // One gentle bounce the moment perception arrives; nothing on settle.
        animate={
          arrived && !reducedMotion ? { scale: [1, 1.06, 1] } : { scale: 1 }
        }
        transition={{ duration: 0.4 }}
      >
        <Image
          src={MASCOT_SRC}
          alt={t('stripAlt')}
          width={28}
          height={28}
          className="h-7 w-7 object-contain"
        />
      </motion.div>
      <div className="min-w-0 flex-1" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={lineKey}
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reducedMotion ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.1 }}
            className={cn(
              'block truncate font-playful text-sm text-gray-600',
              reading && !reducedMotion && 'strip-shimmer',
            )}
          >
            {t(lineKey)}
          </motion.span>
        </AnimatePresence>
      </div>
      <style jsx global>{`
        .strip-shimmer {
          background: linear-gradient(
            90deg,
            #4b5563 0%,
            #4b5563 38%,
            var(--coral-primary, #f76c5e) 50%,
            #4b5563 62%,
            #4b5563 100%
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
          animation: strip-shimmer-slide 2.8s linear infinite;
        }
        @keyframes strip-shimmer-slide {
          from {
            background-position: 200% 0;
          }
          to {
            background-position: -200% 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .strip-shimmer {
            animation: none;
            background: none;
            color: #4b5563;
            -webkit-text-fill-color: currentColor;
          }
        }
      `}</style>
    </div>
  );
}

export default LibrarianStrip;
