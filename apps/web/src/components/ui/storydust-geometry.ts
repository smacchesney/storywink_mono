/**
 * Storydust geometry — the pure, dependency-free half of the waiting system.
 *
 * Shapes, size maps, and class maps live here so they can be unit-tested in
 * a plain node environment; components/ui/storydust.tsx re-exports all of it.
 */

/* ---- Shared shape library (the app has ONE star, one spark, one cloud) --- */

/** Deliberately uneven 4-point star (the twinkle). viewBox 0 0 24 24. */
export const SPARK4 =
  'M12 2.2 L13.7 10.3 L21.8 12 L13.6 13.8 L12 21.8 L10.2 13.6 L2.2 12 L10.4 10.4 Z';

/** Canonical five-point sparkle. viewBox 0 0 24 24. */
export const STAR5 = 'M12 2l2.4 7.4H22l-6 4.6 2.3 7L12 17l-6.3 4 2.3-7-6-4.6h7.6L12 2z';

/** Soft cloud silhouette. Use with CLOUD_VIEWBOX (0 0 120 60). */
export const CLOUD =
  'M30 52c-11 0-20-9-20-20 0-10 7-18 17-20 3-8 11-12 19-12 9 0 17 6 20 14 2-1 4-1 6-1 9 0 16 7 16 16 0 1 0 3-1 4 6 2 10 7 10 13 0 4-3 6-7 6H30z';

export const CLOUD_VIEWBOX = '0 0 120 60';

/** The pencil's wobbly stroke. viewBox 0 0 96 16. */
export const PENCIL_PATH = 'M4 11 q8 -5 16 -2 t16 1 t16 -3 t16 1 t16 -1';

export type StorydustVariant = 'twinkle' | 'pencil' | 'dust' | 'cloud';
export type StorydustSize = 'inline' | 'card' | 'hero';

/* ---- Size maps ------------------------------------------------------------ */

/** Twinkle star widths in px: outer pair + the 25%-larger middle star. */
export function twinkleStarPx(size: StorydustSize): { outer: number; mid: number } {
  switch (size) {
    case 'inline':
      return { outer: 5, mid: 7 };
    case 'card':
      return { outer: 15, mid: 21 };
    case 'hero':
      return { outer: 50, mid: 70 };
  }
}

/** Pencil raster box in px; the viewBox stays 0 0 96 16 at every size. */
export function pencilBoxPx(size: StorydustSize): { width: number; height: number } {
  switch (size) {
    case 'inline':
      return { width: 48, height: 8 };
    case 'card':
      return { width: 96, height: 16 };
    case 'hero':
      return { width: 192, height: 32 };
  }
}

/** Cloud raster width in px (2:1 aspect from the 120x60 viewBox). */
export function cloudWidthPx(size: StorydustSize): number {
  switch (size) {
    case 'inline':
      return 48;
    case 'card':
      return 96;
    case 'hero':
      return 160;
  }
}

/** Determinate pencil offset: full guide (100) at 0, fully drawn (0) at 1. */
export function pencilDashoffset(progress: number): number {
  const clamped = Math.min(Math.max(progress, 0), 1);
  return 100 * (1 - clamped);
}

/* ---- Class maps ------------------------------------------------------------ */

/**
 * Wrapper classes per variant. Defaults set the brand color via
 * `currentColor` so a caller on a dark scrim can pass `className="text-white"`
 * (the component merges caller classes with tailwind-merge, last wins).
 */
export function storydustWrapperClasses(variant: StorydustVariant, size: StorydustSize): string {
  const stack = size === 'inline' ? 'gap-1.5' : 'flex-col gap-2.5';
  switch (variant) {
    case 'twinkle':
      return `inline-flex items-center text-coral [contain:paint] ${stack}`;
    case 'pencil':
      return `inline-flex items-center [contain:paint] ${stack}`;
    case 'dust':
      return 'pointer-events-none absolute inset-0 overflow-hidden text-coral [contain:paint]';
    case 'cloud':
      // No paint containment: the cloud drifts 22px sideways by design.
      return 'pointer-events-none inline-block text-white/70';
  }
}

/* ---- Deterministic compositions ------------------------------------------- */

/** Outer stars sit slightly askew; the middle one leads the wink. */
export const TWINKLE_STARS = [
  { rotate: -12, delay: 0 },
  { rotate: 0, delay: 0.2 },
  { rotate: 14, delay: 0.4 },
] as const;

/**
 * Six deterministic dust stars — the five GenerationProgress positions plus
 * one on the right edge. Durations 22-30s, staggered so they never sync.
 */
export const DUST_STARS = [
  { size: 16, top: '12%', left: '8%', delay: 0, duration: 25 },
  { size: 12, top: '18%', left: '85%', delay: 3, duration: 28 },
  { size: 14, top: '72%', left: '12%', delay: 6, duration: 22 },
  { size: 10, top: '65%', left: '88%', delay: 9, duration: 30 },
  { size: 13, top: '85%', left: '25%', delay: 4, duration: 26 },
  { size: 11, top: '40%', left: '92%', delay: 7, duration: 24 },
] as const;
