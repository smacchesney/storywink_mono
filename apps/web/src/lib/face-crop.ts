/**
 * X17.2 — client-composed Cloudinary face crops for the Who's-in-this-book
 * row. Pure string surgery on `/image/upload/` URLs (cloudinary-loader.ts
 * idiom): Cloudinary treats x/y/w/h values < 1.0 as fractions of the
 * original dimensions, so a normalized perception faceBox maps 1:1 onto a
 * relative c_crop with no knowledge of intrinsic pixel sizes.
 */

export interface FaceBoxLike {
  pageNumber: number;
  x: number;
  y: number;
  w: number;
  h: number;
  assetId?: string | null;
}

/** Rendered circle diameter (px) — fetch at 2x for retina. */
export const FACE_CROP_RENDERED_PX = 64;

/** Padding added around the tight face box, as a fraction of box size. */
export const FACE_CROP_PAD = 0.4;

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Pad the tight box 40% per side, clamped to the frame. */
export function paddedFaceBox(box: FaceBoxLike): { x: number; y: number; w: number; h: number } {
  const padX = box.w * FACE_CROP_PAD;
  const padY = box.h * FACE_CROP_PAD;
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  const w = Math.min(1 - x, box.w + 2 * padX);
  const h = Math.min(1 - y, box.h + 2 * padY);
  return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
}

const isCloudinary = (src: string) => src.includes('/image/upload/');

/** g_face fallback: Cloudinary picks the most prominent face. */
export function faceThumbUrl(src: string): string {
  if (!isCloudinary(src)) return src;
  const px = FACE_CROP_RENDERED_PX * 2;
  return src.replace('/upload/', `/upload/c_thumb,g_face,w_${px},h_${px},f_auto,q_auto/`);
}

/**
 * Face-crop URL: relative c_crop from the padded box, then a square c_fill.
 * Degenerate/missing boxes and non-Cloudinary hosts degrade safely.
 */
export function faceCropUrl(src: string, box: FaceBoxLike | null | undefined): string {
  if (!isCloudinary(src)) return src;
  if (!box || box.w <= 0 || box.h <= 0) return faceThumbUrl(src);
  const p = paddedFaceBox(box);
  if (p.w <= 0 || p.h <= 0) return faceThumbUrl(src);
  const px = FACE_CROP_RENDERED_PX * 2;
  return src.replace(
    '/upload/',
    `/upload/c_crop,x_${p.x},y_${p.y},w_${p.w},h_${p.h}/c_fill,w_${px},h_${px},g_auto,f_auto,q_auto/`,
  );
}
