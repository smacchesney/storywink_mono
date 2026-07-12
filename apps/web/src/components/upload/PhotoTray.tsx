'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Image from 'next/image';
import { useAuth } from '@clerk/nextjs';
import { useTranslations } from 'next-intl';
import { Check, ImagePlus, RotateCw, X } from 'lucide-react';
import { BOOK_CONSTRAINTS } from '@storywink/shared/constants';
import {
  makeFileKey,
  uploadPhotos,
  validateFile,
  type FileKey,
  type UploadErrorKey,
  type UploadedAsset,
} from '@/lib/uploadPhotos';
import { track } from '@/lib/track';
import logger from '@/lib/logger';
import { MASCOT_CAT_PHOTOS } from '@/lib/mascots';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

type TileStatus = 'uploading' | 'done' | 'error';

/** One tile in the tray — either mid-upload, uploaded (has an asset), or failed. */
export interface Tile {
  key: FileKey;
  /** Local object URL for instant preview. Revoked on cleanup. */
  previewUrl: string;
  status: TileStatus;
  /** 0–100 while uploading. */
  progress: number;
  /** The original File — kept so a failed tile can be retried. */
  file: File;
  /** Populated once the upload + notify round-trip succeeds. */
  asset?: UploadedAsset;
  /** i18n key for the failure reason, when status === 'error'. */
  errorKey?: UploadErrorKey;
}

export interface PhotoTrayHandle {
  /** All tiles that finished uploading, in tile (selection) order. */
  getUploadedAssets: () => UploadedAsset[];
  /** True while any tile is still uploading. */
  hasPending: () => boolean;
  /** Count of tiles currently uploading. */
  pendingCount: () => number;
}

interface PhotoTrayProps {
  /** When present, uploads append pages to this book; ✕ calls the page DELETE endpoint. */
  bookId?: string;
  /** Tiles already occupying capacity (existing book pages) — counts toward the cap. */
  existingCount?: number;
  /** Capacity override (default BOOK_CONSTRAINTS.MAX_PHOTOS). The batch studio caps at 10. */
  maxPhotos?: number;
  /**
   * Called whenever the set of successfully uploaded assets changes.
   * Receives assets in tile order. In /create mode the parent reads this to
   * enable Continue; it does not need it for correctness (the ref API is
   * authoritative), but it drives reactive UI.
   */
  onAssetsChange?: (assets: UploadedAsset[]) => void;
  /** Called after every upload settles (success or all-failed) so the parent can refetch. */
  onBatchSettled?: (assets: UploadedAsset[]) => void;
  /**
   * Delete handler for post-upload removal. In bookId mode this should call the
   * page DELETE endpoint and return true on success (false → tile stays,
   * parent surfaces the error). In /create mode, omit it — removal is local.
   */
  onDeleteAsset?: (asset: UploadedAsset) => Promise<boolean>;
  /** Expose imperative reads (uploaded assets / pending state) to the parent. */
  trayRef?: React.Ref<PhotoTrayHandle>;
}

/**
 * The native photo tray — replaces the Cloudinary iframe widget everywhere.
 * A generous "Add photos" card opens the OS picker directly; picked files get
 * instant local thumbnails and upload in the background with a progress ring,
 * a done checkmark, a retry affordance, and an ✕ to remove.
 */
export function PhotoTray({
  bookId,
  existingCount = 0,
  maxPhotos,
  onAssetsChange,
  onBatchSettled,
  onDeleteAsset,
  trayRef,
}: PhotoTrayProps) {
  const t = useTranslations('upload');
  const { getToken } = useAuth();
  const [tiles, setTiles] = useState<Tile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Track object URLs so we can revoke them on unmount without stale closures.
  const objectUrlsRef = useRef<Set<string>>(new Set());

  const cap = maxPhotos ?? BOOK_CONSTRAINTS.MAX_PHOTOS;
  const usedCount = existingCount + tiles.length;
  const remaining = Math.max(0, cap - usedCount);

  // --- Cleanup: revoke every object URL we ever created on unmount. ---
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const uploadedAssets = useMemo(
    () =>
      tiles
        .filter(
          (tile): tile is Tile & { asset: UploadedAsset } =>
            tile.status === 'done' && !!tile.asset,
        )
        .map((tile) => tile.asset),
    [tiles],
  );

  // Notify the parent whenever the uploaded set changes.
  useEffect(() => {
    onAssetsChange?.(uploadedAssets);
  }, [uploadedAssets, onAssetsChange]);

  // Imperative handle for the parent (Continue button logic).
  React.useImperativeHandle(
    trayRef,
    () => ({
      getUploadedAssets: () =>
        tiles
          .filter(
            (tile): tile is Tile & { asset: UploadedAsset } =>
              tile.status === 'done' && !!tile.asset,
          )
          .map((tile) => tile.asset),
      hasPending: () => tiles.some((tile) => tile.status === 'uploading'),
      pendingCount: () =>
        tiles.filter((tile) => tile.status === 'uploading').length,
    }),
    [tiles],
  );

  const updateTile = useCallback((key: FileKey, patch: Partial<Tile>) => {
    setTiles((prev) =>
      prev.map((tile) => (tile.key === key ? { ...tile, ...patch } : tile)),
    );
  }, []);

  // Run a batch of already-created tiles through the upload engine.
  const runUpload = useCallback(
    async (batch: Tile[]) => {
      const keyedFiles = batch.map((tile) => ({
        key: tile.key,
        file: tile.file,
      }));
      try {
        const assets = await uploadPhotos(keyedFiles, {
          bookId,
          getToken,
          onProgress: (key, pct) => updateTile(key, { progress: pct }),
          onFileDone: (key) => updateTile(key, { progress: 100 }),
          onFileError: (key, errorKey) =>
            updateTile(key, { status: 'error', errorKey, progress: 0 }),
        });

        // Attach the created asset to each successful tile.
        setTiles((prev) =>
          prev.map((tile) => {
            const match = assets.find((a) => a.fileKey === tile.key);
            if (match)
              return { ...tile, status: 'done', progress: 100, asset: match };
            return tile;
          }),
        );
        // Funnel telemetry: a batch finished with at least one photo landed.
        if (assets.length > 0) {
          track('upload_completed', {
            ...(bookId ? { bookId } : {}),
            props: { count: assets.length, failed: batch.length - assets.length },
          });
        }
        onBatchSettled?.(assets);
      } catch (err) {
        // Batch-level failure (e.g. no signature). Mark every uploading tile failed.
        logger.error({ err }, 'PhotoTray batch upload failed');
        setTiles((prev) =>
          prev.map((tile) =>
            batch.some((b) => b.key === tile.key) && tile.status === 'uploading'
              ? {
                  ...tile,
                  status: 'error',
                  errorKey: 'errorGeneric',
                  progress: 0,
                }
              : tile,
          ),
        );
      }
    },
    [bookId, getToken, updateTile, onBatchSettled],
  );

  // --- File pick handler ---
  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;

      const picked = Array.from(fileList);
      const roomLeft = remaining;

      const accepted: Tile[] = [];
      let overflow = 0;
      let rejectedType = 0;

      for (const file of picked) {
        if (accepted.length >= roomLeft) {
          overflow += 1;
          continue;
        }
        try {
          validateFile(file);
        } catch {
          rejectedType += 1;
          continue;
        }
        const previewUrl = URL.createObjectURL(file);
        objectUrlsRef.current.add(previewUrl);
        accepted.push({
          key: makeFileKey(),
          previewUrl,
          status: 'uploading',
          progress: 0,
          file,
        });
      }

      if (rejectedType > 0) {
        // Toast lives here so the engine stays UI-agnostic.
        import('sonner').then(({ toast }) =>
          toast.error(t('errorWrongTypeSome', { count: rejectedType })),
        );
      }
      if (overflow > 0) {
        import('sonner').then(({ toast }) =>
          toast.error(t('errorCapReached', { max: cap })),
        );
      }

      if (accepted.length === 0) return;

      setTiles((prev) => [...prev, ...accepted]);
      void runUpload(accepted);
    },
    [remaining, cap, t, runUpload],
  );

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Reset so picking the same file again re-fires change.
      e.target.value = '';
    },
    [handleFiles],
  );

  // --- Retry a failed tile ---
  const retryTile = useCallback(
    (tile: Tile) => {
      const reset: Tile = {
        ...tile,
        status: 'uploading',
        progress: 0,
        errorKey: undefined,
      };
      setTiles((prev) => prev.map((x) => (x.key === tile.key ? reset : x)));
      void runUpload([reset]);
    },
    [runUpload],
  );

  // --- Remove a tile ---
  const removeTile = useCallback(
    async (tile: Tile) => {
      // Post-upload with a book: delegate to the page DELETE endpoint. Keep the
      // tile if the server rejects (cover / min-2 guards) so the parent's toast
      // is the whole story.
      if (bookId && tile.asset && onDeleteAsset) {
        const ok = await onDeleteAsset(tile.asset);
        if (!ok) return;
      }
      URL.revokeObjectURL(tile.previewUrl);
      objectUrlsRef.current.delete(tile.previewUrl);
      setTiles((prev) => prev.filter((x) => x.key !== tile.key));
    },
    [bookId, onDeleteAsset],
  );

  return (
    <div className="w-full">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        onChange={onInputChange}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 md:gap-3">
        {tiles.map((tile) => (
          <PhotoTile
            key={tile.key}
            tile={tile}
            onRetry={() => retryTile(tile)}
            onRemove={() => void removeTile(tile)}
            retryLabel={t('retry')}
            removeLabel={t('remove')}
          />
        ))}

        {remaining > 0 && (
          <AddTile
            onClick={openPicker}
            hasTiles={tiles.length > 0}
            addLabel={t('addPhotos')}
          />
        )}
      </div>

      {/* Reassurance: big photos are optimized automatically — subtle, not a warning. */}
      {tiles.length === 0 && existingCount === 0 && (
        <p className="mt-3 text-center text-xs text-gray-400">
          {t('optimizeHint')}
        </p>
      )}

      {(tiles.length > 0 || existingCount > 0) && (
        <p className="mt-3 text-center text-sm font-medium text-gray-500 font-playful">
          {t('counter', { used: usedCount, max: cap })}
        </p>
      )}
    </div>
  );
}

/** The always-visible "Add photos" card / tile. Big and generous on first pick. */
function AddTile({
  onClick,
  hasTiles,
  addLabel,
}: {
  onClick: () => void;
  hasTiles: boolean;
  addLabel: string;
}) {
  // First-pick state: a generous card with Kai; after that, a compact + tile.
  if (!hasTiles) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group col-span-3 flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-coral/40 bg-coral/[0.04] px-6 py-10 transition-colors hover:border-coral hover:bg-coral/[0.08] sm:col-span-4 md:col-span-5"
      >
        <Image
          src={MASCOT_CAT_PHOTOS}
          alt=""
          width={160}
          height={160}
          className="h-20 w-20 object-contain transition-transform duration-300 group-hover:scale-105 md:h-24 md:w-24"
          priority
        />
        <span className="flex items-center gap-2 rounded-full bg-coral px-5 py-2.5 font-playful text-base text-white shadow-md transition-transform group-hover:scale-[1.02]">
          <ImagePlus className="h-5 w-5" />
          {addLabel}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={addLabel}
      className="group flex aspect-square items-center justify-center rounded-2xl border-2 border-dashed border-coral/40 bg-coral/[0.04] transition-colors hover:border-coral hover:bg-coral/[0.08]"
    >
      <ImagePlus className="h-7 w-7 text-coral transition-transform duration-200 group-hover:scale-110" />
    </button>
  );
}

/** One photo tile: preview + a status overlay (progress ring / check / retry). */
function PhotoTile({
  tile,
  onRetry,
  onRemove,
  retryLabel,
  removeLabel,
}: {
  tile: Tile;
  onRetry: () => void;
  onRemove: () => void;
  retryLabel: string;
  removeLabel: string;
}) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-2xl border border-black/5 bg-gray-100 shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL, next/image can't optimize it */}
      <img
        src={tile.previewUrl}
        alt=""
        className="h-full w-full object-cover"
      />

      {/* Uploading: dim + circular progress ring */}
      {tile.status === 'uploading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35">
          <ProgressRing pct={tile.progress} />
        </div>
      )}

      {/* Error: dim + retry affordance */}
      {tile.status === 'error' && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={retryLabel}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55 text-white transition-colors hover:bg-black/65"
        >
          <RotateCw className="h-6 w-6" />
          <span className="font-playful text-[11px] leading-tight">
            {retryLabel}
          </span>
        </button>
      )}

      {/* Done: subtle checkmark badge — brand coral, never traffic-light green */}
      {tile.status === 'done' && (
        <div className="absolute bottom-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-coral shadow-sm">
          <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
        </div>
      )}

      {/* Remove (✕) — always available */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}

/** A small circular SVG progress ring, coral fill. */
function ProgressRing({ pct }: { pct: number }) {
  const size = 34;
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset =
    circumference - (Math.min(100, Math.max(0, pct)) / 100) * circumference;
  return (
    <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--coral-primary)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-[stroke-dashoffset] duration-200"
      />
    </svg>
  );
}

export default PhotoTray;
