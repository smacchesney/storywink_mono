'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import {
  CLOUD,
  CLOUD_VIEWBOX,
  DUST_STARS,
  PENCIL_PATH,
  SPARK4,
  STAR5,
  TWINKLE_STARS,
  cloudWidthPx,
  pencilBoxPx,
  pencilDashoffset,
  storydustWrapperClasses,
  twinkleStarPx,
  type StorydustSize,
  type StorydustVariant,
} from '@/components/ui/storydust-geometry';

/* ---------------------------------------------------------------------------
 * Storydust — the Storywink waiting system.
 *
 * Storywink is drawing and writing your book right now, and star-dust falls
 * off the pencil while it works. One component, four primitives:
 *
 *   twinkle — three uneven 4-point stars winking in sequence (the workhorse;
 *             replaces every Loader2)
 *   pencil  — a wobbly stroke drawing itself in; determinate with `progress`
 *   dust    — ambient drifting star-dust (hero screens only)
 *   cloud   — a soft cloud silhouette, scenery only
 *
 * All keyframes live in app/globals.css; the single reduced-motion block
 * there governs everything, so this component ships zero JS motion logic.
 * ------------------------------------------------------------------------- */

// The shared shape library — one star, one spark, one cloud across the app.
export {
  CLOUD,
  CLOUD_VIEWBOX,
  PENCIL_PATH,
  SPARK4,
  STAR5,
  cloudWidthPx,
  pencilBoxPx,
  pencilDashoffset,
  storydustWrapperClasses,
  twinkleStarPx,
} from '@/components/ui/storydust-geometry';
export type { StorydustSize, StorydustVariant } from '@/components/ui/storydust-geometry';

/* ---- Internal render helpers --------------------------------------------- */

function TwinkleIcon({ size }: { size: StorydustSize }) {
  const { outer, mid } = twinkleStarPx(size);
  return (
    <span className="inline-flex shrink-0 items-center">
      {TWINKLE_STARS.map((star, i) => {
        const px = i === 1 ? mid : outer;
        return (
          <span
            key={i}
            className="inline-flex"
            style={star.rotate !== 0 ? { transform: `rotate(${star.rotate}deg)` } : undefined}
          >
            <svg
              viewBox="0 0 24 24"
              width={px}
              height={px}
              fill="currentColor"
              aria-hidden="true"
              className={cn('wink-twinkle-star', i === 1 && 'wink-twinkle-star-mid')}
              style={{ animationDelay: `${star.delay}s` }}
            >
              <path d={SPARK4} />
            </svg>
          </span>
        );
      })}
    </span>
  );
}

function PencilIcon({ size, progress }: { size: StorydustSize; progress?: number }) {
  const { width, height } = pencilBoxPx(size);
  const determinate = typeof progress === 'number';
  return (
    <svg
      viewBox="0 0 96 16"
      width={width}
      height={height}
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      {/* The pencil guide — the same path, fully drawn, in the faint wash. */}
      <path
        d={PENCIL_PATH}
        stroke="var(--coral-soft)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={PENCIL_PATH}
        stroke="var(--coral-primary)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={100}
        className={determinate ? 'wink-pencil-progress' : 'wink-pencil-stroke'}
        style={{
          strokeDasharray: 100,
          ...(determinate ? { strokeDashoffset: pencilDashoffset(progress) } : undefined),
        }}
      />
    </svg>
  );
}

function DustField() {
  return (
    <>
      {DUST_STARS.map((star, i) => (
        <svg
          key={i}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          className="wink-dust-star absolute"
          style={{
            top: star.top,
            left: star.left,
            width: star.size,
            height: star.size,
            animationDuration: `${star.duration}s`,
            animationDelay: `${star.delay}s`,
          }}
        >
          <path d={STAR5} />
        </svg>
      ))}
    </>
  );
}

function CloudIcon({ size }: { size: StorydustSize }) {
  const width = cloudWidthPx(size);
  return (
    <svg
      viewBox={CLOUD_VIEWBOX}
      width={width}
      height={width / 2}
      fill="currentColor"
      aria-hidden="true"
      className="cloud-drift-slow shrink-0"
    >
      <path d={CLOUD} />
    </svg>
  );
}

/* ---- The component -------------------------------------------------------- */

export interface StorydustProps {
  variant?: StorydustVariant;
  /** 16 / 48 / 160px scale. */
  size?: StorydustSize;
  /** Announced to screen readers; shown next to the motif when `showLabel`. */
  label?: string;
  /** Default false — the label stays sr-only. */
  showLabel?: boolean;
  /** 0-1; the pencil becomes determinate (state, not decoration). */
  progress?: number;
  className?: string;
}

/**
 * The Storywink waiting motif. With a `label` the wrapper is a polite live
 * region; without one the whole thing is decorative (`aria-hidden`) for
 * cases where a sibling headline already narrates the wait.
 */
export function Storydust({
  variant = 'twinkle',
  size = 'inline',
  label,
  showLabel = false,
  progress,
  className,
}: StorydustProps) {
  const hasLabel = typeof label === 'string' && label.length > 0;
  const a11yProps = hasLabel
    ? ({ role: 'status', 'aria-live': 'polite' } as const)
    : ({ 'aria-hidden': true } as const);

  return (
    <div {...a11yProps} className={cn(storydustWrapperClasses(variant, size), className)}>
      {variant === 'twinkle' && <TwinkleIcon size={size} />}
      {variant === 'pencil' && <PencilIcon size={size} progress={progress} />}
      {variant === 'dust' && <DustField />}
      {variant === 'cloud' && <CloudIcon size={size} />}
      {hasLabel && (
        <span className={showLabel ? 'font-playful text-sm text-[var(--ink-soft)]' : 'sr-only'}>
          {label}
        </span>
      )}
    </div>
  );
}

export default Storydust;
