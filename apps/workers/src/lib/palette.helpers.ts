/**
 * Palette normalization (PALETTE_NORMALIZE_ENABLED) — pure math helpers.
 *
 * After a book completes, each page render is nudged toward the title-page
 * render's color statistics: a partial-strength (40%) per-channel mean/std
 * color transfer. That catches residual palette drift QC does not flag (a
 * page that is "too warm" still passes character/style checks) without ever
 * changing composition. The transfer is linear per channel, so it collapses
 * to a single `sharp().linear(a, b)` call in the orchestrator.
 *
 * Everything here is deterministic and dependency-free (no sharp/Prisma) so
 * the statistics and coefficient math are unit-testable.
 */

/** Workers env flag — default OFF. */
export function paletteNormalizeEnabled(): boolean {
  return process.env.PALETTE_NORMALIZE_ENABLED === 'true';
}

/** Blend strength toward the title-page reference (0 = no-op, 1 = full transfer). */
export const PALETTE_STRENGTH = 0.4;

/** Hard wall-clock budget for the whole book; past it remaining pages are skipped. */
export const PALETTE_BUDGET_MS = 60_000;

/**
 * Std-ratio clamp: keeps a near-flat page (tiny std) from exploding contrast
 * when matched against a busy reference, and vice versa. A 40%-strength
 * transfer inside [0.5, 2] can shift contrast by at most ±40%.
 */
export const STD_RATIO_MIN = 0.5;
export const STD_RATIO_MAX = 2;

export interface ChannelStats {
  /** Per-channel means (RGB), 0-255. */
  mean: [number, number, number];
  /** Per-channel standard deviations (RGB). */
  std: [number, number, number];
}

/**
 * Mean and standard deviation per RGB channel over an interleaved raw pixel
 * buffer (as produced by sharp `.raw()`). `channels` is the stride; only the
 * first three channels are read, so RGBA input is fine.
 */
export function computeChannelStats(pixels: Uint8Array, channels: number): ChannelStats {
  if (channels < 3) {
    throw new Error(`computeChannelStats needs >= 3 channels, got ${channels}`);
  }
  const pixelCount = Math.floor(pixels.length / channels);
  if (pixelCount === 0) {
    throw new Error('computeChannelStats got an empty pixel buffer');
  }

  const sum = [0, 0, 0];
  const sumSq = [0, 0, 0];
  for (let i = 0; i < pixelCount; i++) {
    const base = i * channels;
    for (let c = 0; c < 3; c++) {
      const v = pixels[base + c];
      sum[c] += v;
      sumSq[c] += v * v;
    }
  }

  const mean = sum.map((s) => s / pixelCount) as [number, number, number];
  const std = sumSq.map((sq, c) => {
    const variance = sq / pixelCount - mean[c] * mean[c];
    return Math.sqrt(Math.max(0, variance));
  }) as [number, number, number];

  return { mean, std };
}

export interface TransferCoefficients {
  /** Per-channel multiplier for sharp `.linear(multipliers, offsets)`. */
  multipliers: [number, number, number];
  /** Per-channel offset for sharp `.linear(multipliers, offsets)`. */
  offsets: [number, number, number];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Coefficients of the partial-strength channel-mean/std color transfer,
 * folded into one linear map per channel:
 *
 *   full transfer:  out = (in - muS) * (stdR / stdS) + muR
 *   partial (s):    out = (1 - s) * in + s * full  =  a * in + b
 *     a = 1 - s + s * ratio
 *     b = s * (muR - ratio * muS)
 *
 * With strength 0 (or identical stats) this is exactly the identity map.
 */
export function computeTransferCoefficients(
  source: ChannelStats,
  reference: ChannelStats,
  strength: number = PALETTE_STRENGTH,
): TransferCoefficients {
  const s = clamp(strength, 0, 1);
  const multipliers = [0, 0, 0] as [number, number, number];
  const offsets = [0, 0, 0] as [number, number, number];

  for (let c = 0; c < 3; c++) {
    const stdS = source.std[c];
    const stdR = reference.std[c];
    // A zero-variance channel has no spread to rescale — transfer means only.
    const ratio = stdS > 0 ? clamp(stdR / stdS, STD_RATIO_MIN, STD_RATIO_MAX) : 1;
    multipliers[c] = 1 - s + s * ratio;
    // `+ 0` folds the -0 that strength 0 produces back to plain 0.
    offsets[c] = s * (reference.mean[c] - ratio * source.mean[c]) + 0;
  }

  return { multipliers, offsets };
}

/**
 * Per-channel mean delta (reference - source) — the log line's "how far off
 * was this page" number, in 0-255 units.
 */
export function meanDelta(source: ChannelStats, reference: ChannelStats): [number, number, number] {
  return [0, 1, 2].map((c) => reference.mean[c] - source.mean[c]) as [number, number, number];
}

/**
 * True when the transfer is close enough to identity that re-encoding and
 * re-uploading the page would burn time for an invisible change.
 */
export function isNearIdentity(
  coefficients: TransferCoefficients,
  epsilonMultiplier = 0.01,
  epsilonOffset = 0.5,
): boolean {
  return coefficients.multipliers.every(
    (m, c) =>
      Math.abs(m - 1) <= epsilonMultiplier && Math.abs(coefficients.offsets[c]) <= epsilonOffset,
  );
}
