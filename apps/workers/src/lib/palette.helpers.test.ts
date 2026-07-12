import { afterEach, describe, expect, it } from 'vitest';
import {
  computeChannelStats,
  computeTransferCoefficients,
  isNearIdentity,
  meanDelta,
  paletteNormalizeEnabled,
  STD_RATIO_MAX,
  STD_RATIO_MIN,
  type ChannelStats,
} from './palette.helpers.js';

afterEach(() => {
  delete process.env.PALETTE_NORMALIZE_ENABLED;
});

describe('paletteNormalizeEnabled', () => {
  it('defaults OFF and requires the exact string "true"', () => {
    expect(paletteNormalizeEnabled()).toBe(false);
    process.env.PALETTE_NORMALIZE_ENABLED = '1';
    expect(paletteNormalizeEnabled()).toBe(false);
    process.env.PALETTE_NORMALIZE_ENABLED = 'true';
    expect(paletteNormalizeEnabled()).toBe(true);
  });
});

describe('computeChannelStats', () => {
  it('computes per-channel mean and std on RGB data', () => {
    // Two pixels: (0, 100, 200) and (100, 100, 0)
    const pixels = new Uint8Array([0, 100, 200, 100, 100, 0]);
    const stats = computeChannelStats(pixels, 3);
    expect(stats.mean).toEqual([50, 100, 100]);
    expect(stats.std[0]).toBeCloseTo(50, 5);
    expect(stats.std[1]).toBeCloseTo(0, 5);
    expect(stats.std[2]).toBeCloseTo(100, 5);
  });

  it('ignores the alpha channel on RGBA data', () => {
    const rgb = new Uint8Array([10, 20, 30, 50, 60, 70]);
    const rgba = new Uint8Array([10, 20, 30, 255, 50, 60, 70, 128]);
    expect(computeChannelStats(rgba, 4)).toEqual(computeChannelStats(rgb, 3));
  });

  it('rejects empty buffers and sub-RGB strides', () => {
    expect(() => computeChannelStats(new Uint8Array([]), 3)).toThrow();
    expect(() => computeChannelStats(new Uint8Array([1, 2]), 2)).toThrow();
  });
});

describe('computeTransferCoefficients', () => {
  const source: ChannelStats = { mean: [100, 120, 140], std: [20, 30, 40] };
  const reference: ChannelStats = { mean: [110, 110, 150], std: [25, 30, 20] };

  it('is the identity at strength 0', () => {
    const { multipliers, offsets } = computeTransferCoefficients(source, reference, 0);
    expect(multipliers).toEqual([1, 1, 1]);
    expect(offsets).toEqual([0, 0, 0]);
  });

  it('is the identity when source and reference stats match', () => {
    const coefficients = computeTransferCoefficients(source, source, 0.4);
    expect(isNearIdentity(coefficients)).toBe(true);
  });

  it('maps the source mean partway to the reference mean at strength 0.4', () => {
    const { multipliers, offsets } = computeTransferCoefficients(source, reference, 0.4);
    for (let c = 0; c < 3; c++) {
      const mappedMean = multipliers[c] * source.mean[c] + offsets[c];
      const expected = source.mean[c] + 0.4 * (reference.mean[c] - source.mean[c]);
      expect(mappedMean).toBeCloseTo(expected, 6);
    }
  });

  it('performs the full mean/std transfer at strength 1', () => {
    const { multipliers, offsets } = computeTransferCoefficients(source, reference, 1);
    // Channel 0: ratio 25/20 = 1.25 (unclamped)
    expect(multipliers[0]).toBeCloseTo(1.25, 6);
    const mappedMean = multipliers[0] * source.mean[0] + offsets[0];
    expect(mappedMean).toBeCloseTo(reference.mean[0], 6);
  });

  it('clamps extreme std ratios', () => {
    const flat: ChannelStats = { mean: [100, 100, 100], std: [1, 1, 1] };
    const busy: ChannelStats = { mean: [100, 100, 100], std: [100, 100, 100] };
    const up = computeTransferCoefficients(flat, busy, 1);
    expect(up.multipliers[0]).toBeCloseTo(STD_RATIO_MAX, 6);
    const down = computeTransferCoefficients(busy, flat, 1);
    expect(down.multipliers[0]).toBeCloseTo(STD_RATIO_MIN, 6);
  });

  it('transfers means only when a source channel has zero variance', () => {
    const flat: ChannelStats = { mean: [100, 100, 100], std: [0, 0, 0] };
    const { multipliers, offsets } = computeTransferCoefficients(flat, reference, 0.4);
    expect(multipliers[0]).toBeCloseTo(1, 6);
    expect(offsets[0]).toBeCloseTo(0.4 * (reference.mean[0] - flat.mean[0]), 6);
  });

  it('clamps strength into [0, 1]', () => {
    const over = computeTransferCoefficients(source, reference, 5);
    const one = computeTransferCoefficients(source, reference, 1);
    expect(over).toEqual(one);
  });
});

describe('meanDelta', () => {
  it('reports reference minus source per channel', () => {
    const source: ChannelStats = { mean: [100, 120, 140], std: [1, 1, 1] };
    const reference: ChannelStats = { mean: [90, 130, 140], std: [1, 1, 1] };
    expect(meanDelta(source, reference)).toEqual([-10, 10, 0]);
  });
});

describe('isNearIdentity', () => {
  it('accepts tiny corrections and rejects visible ones', () => {
    expect(isNearIdentity({ multipliers: [1.005, 1, 0.999], offsets: [0.2, 0, -0.4] })).toBe(true);
    expect(isNearIdentity({ multipliers: [1.1, 1, 1], offsets: [0, 0, 0] })).toBe(false);
    expect(isNearIdentity({ multipliers: [1, 1, 1], offsets: [3, 0, 0] })).toBe(false);
  });
});
