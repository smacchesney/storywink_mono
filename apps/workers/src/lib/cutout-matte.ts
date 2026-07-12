/**
 * In-house background removal for avatar cutouts (owner decision 2026-07-12:
 * no Cloudinary add-on dependency — a stored transparent PNG is a permanent
 * reusable asset).
 *
 * The cutout is GENERATED on pure white by design, so removal is a
 * border-seeded flood fill of near-white: every near-white pixel connected to
 * the image border is background (this subsumes corner seeding); enclosed
 * white regions — a white shirt, teeth, eye highlights — are never touched.
 * The edge is feathered with a small box blur of the mask so the figure
 * doesn't get a jagged halo.
 *
 * Pure pixel math over an RGBA buffer — no sharp, no I/O — per the
 * pure-helper test convention. The sharp decode/encode wrapper lives with
 * the caller (avatar-renditions.ts).
 */

export interface MatteOptions {
  /** A pixel is background-candidate when min(r,g,b) >= whiteFloor. */
  whiteFloor?: number;
  /** Feather radius in pixels (box blur of the mask). 0 = hard edge. */
  featherRadius?: number;
}

export interface MatteResult {
  /**
   * Share of pixels cleared to transparent. Callers should treat extreme
   * values as a failed matte and fall back to the white original:
   * ~0 means the model ignored the white-background instruction; ~1 means
   * the figure itself was eaten.
   */
  backgroundRatio: number;
}

const DEFAULT_WHITE_FLOOR = 235;
const DEFAULT_FEATHER_RADIUS = 1;

/**
 * Mutates `data` (RGBA, row-major) in place: border-connected near-white
 * becomes transparent with a feathered edge. Returns matte metrics.
 */
export function matteWhiteBackground(
  data: Uint8Array,
  width: number,
  height: number,
  options: MatteOptions = {},
): MatteResult {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`matteWhiteBackground: bad dimensions ${width}x${height}`);
  }
  if (data.length !== width * height * 4) {
    throw new Error(
      `matteWhiteBackground: buffer length ${data.length} does not match ${width}x${height} RGBA`,
    );
  }
  const whiteFloor = options.whiteFloor ?? DEFAULT_WHITE_FLOOR;
  const featherRadius = options.featherRadius ?? DEFAULT_FEATHER_RADIUS;

  const pixelCount = width * height;
  const isWhite = (p: number): boolean => {
    const i = p * 4;
    return data[i] >= whiteFloor && data[i + 1] >= whiteFloor && data[i + 2] >= whiteFloor;
  };

  // Flood fill (4-connected) from every near-white border pixel.
  const background = new Uint8Array(pixelCount); // 1 = background
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const seed = (p: number) => {
    if (!background[p] && isWhite(p)) {
      background[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x); // top row
    seed((height - 1) * width + x); // bottom row
  }
  for (let y = 0; y < height; y++) {
    seed(y * width); // left column
    seed(y * width + width - 1); // right column
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    if (x > 0) seed(p - 1);
    if (x < width - 1) seed(p + 1);
    if (p >= width) seed(p - width);
    if (p < pixelCount - width) seed(p + width);
  }

  let backgroundCount = 0;
  for (let p = 0; p < pixelCount; p++) backgroundCount += background[p];

  // Alpha = 255 * (1 - blurred background mask). With radius 0 this is the
  // hard mask; with radius r, pixels near the boundary get partial alpha on
  // both sides, which reads as a soft anti-aliased cut.
  if (featherRadius <= 0) {
    for (let p = 0; p < pixelCount; p++) {
      if (background[p]) data[p * 4 + 3] = 0;
    }
  } else {
    const r = Math.floor(featherRadius);
    const window = 2 * r + 1;
    const area = window * window;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = Math.min(height - 1, Math.max(0, y + dy));
          for (let dx = -r; dx <= r; dx++) {
            const xx = Math.min(width - 1, Math.max(0, x + dx));
            sum += background[yy * width + xx];
          }
        }
        const p = y * width + x;
        if (sum === 0) continue; // fully foreground — leave alpha alone
        const alpha = Math.round(255 * (1 - sum / area));
        const i = p * 4 + 3;
        if (background[p]) {
          // Background never keeps more alpha than the feather grants it,
          // and deep background goes fully clear.
          data[i] = Math.min(data[i], alpha);
        } else {
          data[i] = Math.min(data[i], Math.max(alpha, 0));
        }
      }
    }
    // Deep background (fully surrounded by background) must be exactly 0 —
    // the blur already yields 0 there; boundary background keeps its partial.
  }

  return { backgroundRatio: backgroundCount / pixelCount };
}
