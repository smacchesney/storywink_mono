/**
 * Native client-side upload engine — replaces the Cloudinary iframe widget.
 *
 * Flow (see .claude/rules/architecture.md — "Direct Cloudinary uploads"):
 *   1. Fetch ONE signed-upload signature from /api/upload/signature (authed).
 *   2. Downscale each image in the browser (createImageBitmap → canvas → jpeg)
 *      so a busy parent on a phone isn't shipping 8 MB HEIC-transcodes over
 *      cellular. HEIC/HEIF are skipped (browsers can't decode them); Cloudinary
 *      transcodes those server-side.
 *   3. Upload each file DIRECTLY to Cloudinary via XMLHttpRequest (fetch has no
 *      upload-progress events) with a concurrency pool of 3 and one retry on a
 *      network failure.
 *   4. POST the settled batch to /api/cloudinary/notify (with bookId when we're
 *      appending to an existing book) so Asset (+Page) rows get created.
 *
 * The signature signs only { timestamp, folder }, so a single signature is
 * reusable for every file in the batch within its ~1 hour validity window.
 */

import { BOOK_CONSTRAINTS } from '@storywink/shared/constants';
import logger from '@/lib/logger';

// --- Compression defaults (iOS-"Medium" equivalent) ---------------------
// Tunable knobs for the client-side downscale. Nothing downstream needs more
// resolution than this: vision perception calls are optimized to ~2K anyway,
// Gemini reference images don't benefit past 2048px, and originals are never
// printed (only the generated illustrations are). Shrinking here makes mobile
// uploads dramatically faster on cellular.
/** Long edge (px) we downscale to before upload. */
const MAX_LONG_EDGE_PX = 2048;
/** JPEG re-encode quality. 0.82 ≈ iOS "Medium". */
const JPEG_QUALITY = 0.82;
/** Files already under this size skip the downscale round-trip (~900 KB). */
const SKIP_UNDER_BYTES = 900 * 1024;
/** Hard cap enforced client-side, AFTER downscale. Mirrors the widget's 10 MB. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** How many uploads run at once. Keeps mobile connections from stalling. */
const CONCURRENCY = 3;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

/** A stable per-file key the UI uses to route progress/error events back to a tile. */
export type FileKey = string;

/** The final record returned to callers — mirrors /api/cloudinary/notify's asset payload. */
export interface UploadedAsset {
  /** Database Asset id (from /api/cloudinary/notify). */
  id: string;
  url: string;
  thumbnailUrl: string | null;
  /** The tile key this asset came from, so callers can preserve tile order. */
  fileKey: FileKey;
}

/** Shape of one asset in the /api/cloudinary/notify request body. */
interface CloudinaryAssetPayload {
  publicId: string;
  url: string;
  thumbnailUrl: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
}

export interface UploadPhotosOptions {
  /** When present, notify appends Page rows to this book and refreshes perception. */
  bookId?: string;
  /** Auth token getter (Clerk). Called once per batch. */
  getToken: () => Promise<string | null>;
  /** Fires 0–100 as each file uploads. */
  onProgress?: (fileKey: FileKey, pct: number) => void;
  /** Fires once a file's Cloudinary upload succeeds (before the notify round-trip). */
  onFileDone?: (fileKey: FileKey) => void;
  /** Fires with a translation KEY (not a message) so the UI owns i18n copy. */
  onFileError?: (fileKey: FileKey, errorKey: UploadErrorKey) => void;
}

/**
 * Translation keys under the `upload` namespace. The engine never renders copy
 * itself — it hands the UI a key so error text stays in messages/{en,ja}.json.
 */
export type UploadErrorKey = 'errorTooBig' | 'errorWrongType' | 'errorNetwork' | 'errorGeneric';

/** A file paired with its stable UI key. */
export interface KeyedFile {
  key: FileKey;
  file: File;
}

class UploadError extends Error {
  constructor(public readonly key: UploadErrorKey) {
    super(key);
    this.name = 'UploadError';
  }
}

/** Generate a collision-resistant key for a freshly picked File. */
export function makeFileKey(): FileKey {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/** True for HEIC/HEIF — browsers can't decode these to a canvas, so we upload raw. */
function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    type === 'image/heic' ||
    type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

/**
 * Validate a single file BEFORE upload. Throws UploadError with an i18n key.
 * Note: the size cap is re-checked post-downscale in uploadOne — this is the
 * cheap first gate for obviously-wrong picks.
 */
export function validateFile(file: File): void {
  const type = file.type.toLowerCase();
  const heic = isHeic(file);
  // Some HEIC files arrive with an empty MIME type on certain browsers; allow
  // them through the type gate since the extension already flagged them.
  if (!heic && !ALLOWED_MIME.has(type)) {
    throw new UploadError('errorWrongType');
  }
  // Pre-downscale size gate is generous (raw phone photos can be 8–12 MB and
  // still downscale under the cap). Only reject truly huge files up front.
  if (file.size > MAX_UPLOAD_BYTES * 3) {
    throw new UploadError('errorTooBig');
  }
}

/**
 * Downscale a jpeg/png/webp to <= MAX_EDGE on its long side and re-encode as
 * JPEG q0.85. Returns { blob, format } to upload. On ANY failure — or for HEIC,
 * or for already-small files — returns null so the caller uploads the original.
 */
async function downscale(file: File): Promise<{ blob: Blob; format: string } | null> {
  if (isHeic(file)) return null;
  if (file.size < SKIP_UNDER_BYTES) return null;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return null;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const longEdge = Math.max(width, height);
    if (longEdge <= MAX_LONG_EDGE_PX) {
      // Already small enough dimensionally; only re-encode if it saves bytes.
      // Keep it simple: leave the original alone.
      return null;
    }

    const scale = MAX_LONG_EDGE_PX / longEdge;
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY);
    });
    if (!blob) return null;

    // If the "downscaled" blob somehow ended up larger, keep the original.
    if (blob.size >= file.size) return null;

    return { blob, format: 'jpg' };
  } catch (err) {
    logger.warn({ err, name: file.name }, 'Client downscale failed — uploading original');
    return null;
  } finally {
    bitmap?.close?.();
  }
}

interface Signature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  signature: string;
}

async function fetchSignature(token: string | null): Promise<Signature> {
  const res = await fetch('/api/upload/signature', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new UploadError('errorGeneric');
  }
  return (await res.json()) as Signature;
}

/**
 * Derive a small delivery thumbnail from a Cloudinary secure_url by inserting a
 * limit transform right after /upload/. Matches the widget's client-derived
 * thumbnail contract.
 */
function deriveThumbnailUrl(secureUrl: string): string {
  return secureUrl.replace('/upload/', '/upload/c_limit,w_400,q_auto/');
}

interface CloudinaryUploadResult {
  public_id: string;
  secure_url: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
}

/**
 * Upload one blob to Cloudinary via XHR, reporting progress. Rejects with an
 * UploadError('errorNetwork') on transport failure so the caller can retry.
 */
function xhrUpload(
  blob: Blob,
  filename: string,
  sig: Signature,
  onProgress: (pct: number) => void,
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', blob, filename);
    form.append('api_key', sig.apiKey);
    form.append('timestamp', String(sig.timestamp));
    form.append('folder', sig.folder);
    form.append('signature', sig.signature);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        // Cap at 99 during transfer; 100 is reserved for a confirmed response.
        onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as CloudinaryUploadResult;
          onProgress(100);
          resolve(parsed);
        } catch {
          reject(new UploadError('errorGeneric'));
        }
      } else if (xhr.status === 400) {
        // Cloudinary rejects oversize / bad-format here.
        reject(new UploadError('errorTooBig'));
      } else {
        reject(new UploadError('errorNetwork'));
      }
    };

    xhr.onerror = () => reject(new UploadError('errorNetwork'));
    xhr.ontimeout = () => reject(new UploadError('errorNetwork'));

    xhr.send(form);
  });
}

/** Upload a single keyed file end-to-end: downscale → XHR (with one retry). */
async function uploadOne(
  keyed: KeyedFile,
  sig: Signature,
  opts: UploadPhotosOptions,
): Promise<CloudinaryAssetPayload> {
  const { key, file } = keyed;

  validateFile(file);

  const scaled = await downscale(file);
  const blob: Blob = scaled?.blob ?? file;
  const filename = file.name || 'photo';

  // Post-downscale size gate.
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new UploadError('errorTooBig');
  }

  const runUpload = () => xhrUpload(blob, filename, sig, (pct) => opts.onProgress?.(key, pct));

  let result: CloudinaryUploadResult;
  try {
    result = await runUpload();
  } catch (err) {
    // Retry once, but only on a network-class failure.
    if (err instanceof UploadError && err.key === 'errorNetwork') {
      logger.warn({ name: filename }, 'Upload network error — retrying once');
      opts.onProgress?.(key, 0);
      result = await runUpload();
    } else {
      throw err;
    }
  }

  opts.onFileDone?.(key);

  return {
    publicId: result.public_id,
    url: result.secure_url,
    thumbnailUrl: deriveThumbnailUrl(result.secure_url),
    format: result.format,
    bytes: result.bytes,
    width: result.width,
    height: result.height,
  };
}

/**
 * Notify the backend of successful Cloudinary uploads so Asset (+Page) rows are
 * created. Returns db assets keyed back to their tiles via array position:
 * notify preserves input order, so the Nth returned asset maps to the Nth
 * uploaded file.
 */
async function notify(
  uploaded: Array<{ key: FileKey; payload: CloudinaryAssetPayload }>,
  opts: UploadPhotosOptions,
): Promise<UploadedAsset[]> {
  const token = await opts.getToken();
  const res = await fetch('/api/cloudinary/notify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      assets: uploaded.map((u) => u.payload),
      ...(opts.bookId ? { bookId: opts.bookId } : {}),
    }),
  });

  if (!res.ok) {
    throw new UploadError('errorGeneric');
  }

  const json = await res.json();
  const dbAssets: Array<{
    id: string;
    url: string;
    thumbnailUrl: string | null;
  }> = json.data?.assets ?? [];

  // notify creates rows in the order they were sent, so zip by index.
  return dbAssets.map((asset, i) => ({
    id: asset.id,
    url: asset.url,
    thumbnailUrl: asset.thumbnailUrl,
    fileKey: uploaded[i]?.key ?? makeFileKey(),
  }));
}

/**
 * Upload a batch of keyed files and create their database records.
 *
 * Resolves with the created assets (in the order Cloudinary uploads settled,
 * NOT input order — callers that care about order should reorder by fileKey).
 * Per-file failures are surfaced via onFileError and simply excluded from the
 * result; one bad file never sinks the batch.
 */
export async function uploadPhotos(
  files: KeyedFile[],
  opts: UploadPhotosOptions,
): Promise<UploadedAsset[]> {
  if (files.length === 0) return [];

  // Client-side batch cap. The book create / notify endpoints also enforce
  // this, but failing fast here spares the round-trips.
  if (files.length > BOOK_CONSTRAINTS.MAX_PHOTOS) {
    files = files.slice(0, BOOK_CONSTRAINTS.MAX_PHOTOS);
  }

  const token = await opts.getToken();
  const sig = await fetchSignature(token);

  // Concurrency pool of CONCURRENCY, preserving per-file error isolation.
  const succeeded: Array<{ key: FileKey; payload: CloudinaryAssetPayload }> = [];
  let cursor = 0;

  async function worker() {
    while (cursor < files.length) {
      const idx = cursor++;
      const keyed = files[idx];
      try {
        const payload = await uploadOne(keyed, sig, opts);
        succeeded.push({ key: keyed.key, payload });
      } catch (err) {
        const errorKey = err instanceof UploadError ? err.key : ('errorGeneric' as UploadErrorKey);
        opts.onFileError?.(keyed.key, errorKey);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, () => worker()));

  if (succeeded.length === 0) return [];

  return notify(succeeded, opts);
}

/**
 * Upload a SINGLE file and create its Asset row only (no bookId → no Page).
 * Used by the resolve flow's photo swap, which then calls replace-photo itself.
 * Throws UploadError on failure (single-file flows want to know about failure).
 */
export async function uploadSinglePhoto(
  file: File,
  opts: Pick<UploadPhotosOptions, 'getToken' | 'onProgress'> & {
    fileKey?: FileKey;
  },
): Promise<UploadedAsset> {
  const key = opts.fileKey ?? makeFileKey();
  validateFile(file);

  const token = await opts.getToken();
  const sig = await fetchSignature(token);
  const payload = await uploadOne({ key, file }, sig, {
    getToken: opts.getToken,
    onProgress: opts.onProgress,
  });

  const assets = await notify([{ key, payload }], { getToken: opts.getToken });
  if (assets.length === 0) {
    throw new UploadError('errorGeneric');
  }
  return assets[0];
}
