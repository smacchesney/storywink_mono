'use client';

import React from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { optimizeCloudinaryUrl } from '@storywink/shared';
import { Storydust, SPARK4 } from '@/components/ui/storydust';
import { MASCOT_CAT_PHOTOS } from '@/lib/mascots';
import {
  STRIP_FACES_AT_MS,
  STRIP_READING_AT_MS,
  type StripPhase,
} from '@/components/create/setup/strip-phase';
import { ribbonLineKey } from '@/components/create/setup/wizard-steps';
import type { StripPhoto } from '@/components/create/setup/PhotoStrip';

const THUMB_SWEEP_MS = 1100;
const MAX_THUMBS = 4;

interface ReadingRibbonProps {
  phase: StripPhase;
  photos: StripPhoto[];
  /** Step 3's reading theater: bigger mascot, centered column. */
  hero?: boolean;
}

/**
 * X18 — the one visible "AI is reading your photos" surface. Compact ribbon
 * under the wizard header on steps 1-2; hero variant is step 3's reading
 * state. No counter (perception persists in one transaction), no arrival
 * bounce — on arrival the line flips to the handoff copy and the ribbon dims.
 */
export function ReadingRibbon({ phase, photos, hero }: ReadingRibbonProps) {
  const t = useTranslations('setup');
  const reducedMotion = useReducedMotion() ?? false;

  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (phase !== 'reading') return;
    setElapsed(0);
    const t1 = setTimeout(() => setElapsed(STRIP_FACES_AT_MS), STRIP_FACES_AT_MS);
    const t2 = setTimeout(() => setElapsed(STRIP_READING_AT_MS), STRIP_READING_AT_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [phase]);

  const thumbs = photos.slice(0, MAX_THUMBS);
  const reading = phase === 'reading';
  const [sparkIdx, setSparkIdx] = React.useState(0);
  React.useEffect(() => {
    if (!reading || reducedMotion || thumbs.length === 0) return;
    const id = setInterval(() => setSparkIdx((i) => (i + 1) % thumbs.length), THUMB_SWEEP_MS);
    return () => clearInterval(id);
  }, [reading, reducedMotion, thumbs.length]);

  const lineKey = ribbonLineKey(phase, elapsed);
  if (!lineKey) return null;

  return (
    <div
      className={cn(
        'rounded-2xl bg-coral/5 transition-opacity duration-300',
        hero ? 'flex flex-col items-center gap-3 px-4 py-6' : 'flex items-center gap-2.5 px-3 py-2',
        !reading && 'opacity-60',
      )}
    >
      <Image
        src={MASCOT_CAT_PHOTOS}
        alt={t('stripAlt')}
        width={hero ? 64 : 28}
        height={hero ? 64 : 28}
        className={hero ? 'h-16 w-16 object-contain' : 'h-7 w-7 object-contain'}
      />
      <div
        className={cn('flex min-w-0 items-center gap-1.5', hero && 'justify-center')}
        aria-hidden="true"
      >
        {thumbs.map((p, i) => {
          const src = p.thumbnailUrl || p.url;
          return (
            <span
              key={p.id}
              className={cn(
                'relative shrink-0 overflow-hidden rounded-lg border border-black/5 bg-gray-100',
                hero ? 'h-12 w-12' : 'h-8 w-8',
              )}
            >
              {src ? (
                <Image
                  src={optimizeCloudinaryUrl(src)}
                  alt=""
                  fill
                  sizes={hero ? '48px' : '32px'}
                  className="object-cover"
                />
              ) : null}
              {reading && !reducedMotion && sparkIdx === i && (
                <svg
                  viewBox="0 0 24 24"
                  width={12}
                  height={12}
                  fill="currentColor"
                  aria-hidden="true"
                  className="wink-twinkle-star absolute top-0.5 right-0.5 text-white drop-shadow"
                >
                  <path d={SPARK4} />
                </svg>
              )}
            </span>
          );
        })}
      </div>
      <div
        className={cn('flex min-w-0 flex-1 items-center gap-2', hero && 'flex-none justify-center')}
        aria-live="polite"
      >
        {reading && <Storydust variant="twinkle" size="inline" />}
        <span
          className={cn(
            'block min-w-0 truncate font-playful text-sm text-gray-600',
            reading && 'text-working-shimmer',
          )}
        >
          {t(lineKey)}
        </span>
      </div>
    </div>
  );
}

export default ReadingRibbon;
