'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useReducedMotion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import { ImagePlus, X } from 'lucide-react';
import { Storydust, SPARK4 } from '@/components/ui/storydust';
import { optimizeCloudinaryUrl, BOOK_CONSTRAINTS } from '@storywink/shared';
import { makeFileKey, uploadPhotos, validateFile } from '@/lib/uploadPhotos';
import { stripThumbFlags } from '@/components/create/setup/photo-strip-flags';
import logger from '@/lib/logger';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif';

export interface StripPhoto {
  id: string;
  thumbnailUrl: string | null;
  url: string | null;
}

interface PhotoStripProps {
  photos: StripPhoto[];
  /** Fires with the reordered array (in new page order) after a drag. */
  onReorder: (photos: StripPhoto[]) => void;
  /**
   * When present, enables the inline "+" tile (uploads append pages to this
   * book) and the ✕ remove button (calls the page DELETE endpoint).
   */
  bookId?: string;
  /**
   * Called after photos have been uploaded+appended, or after a page has been
   * removed, so the parent can refetch the book (which re-derives the strip).
   */
  onPhotosChanged?: () => void | Promise<void>;
  /** X17 B1: true while perception reads — a spark sweeps the thumbnails. */
  reading?: boolean;
  /** False when the book has a composed cover (coverAssetId null). Default
   * true keeps legacy photo-cover semantics — SetupSheet is the only
   * callsite today, so undefined = legacy everywhere else forever. */
  hasPhotoCover?: boolean;
}

function SortableThumb({
  photo,
  isCover,
  coverLabel,
  removable,
  removing,
  onRemove,
  removeLabel,
  sparkling,
}: {
  photo: StripPhoto;
  isCover: boolean;
  coverLabel: string;
  removable: boolean;
  removing: boolean;
  onRemove: () => void;
  removeLabel: string;
  sparkling: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: photo.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  };

  const src = photo.thumbnailUrl || photo.url;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-black/5 bg-gray-100 shadow-sm"
    >
      {/* Drag surface — separated from the ✕ so removing doesn't start a drag. */}
      <div
        {...attributes}
        {...listeners}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
      >
        {src ? (
          <Image
            src={optimizeCloudinaryUrl(src)}
            alt=""
            fill
            sizes="64px"
            className="pointer-events-none object-cover"
          />
        ) : null}
      </div>

      {sparkling && (
        <span className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-coral/50">
          <svg
            viewBox="0 0 24 24"
            width={14}
            height={14}
            fill="currentColor"
            aria-hidden="true"
            className="wink-twinkle-star absolute top-1 right-1 text-white drop-shadow"
          >
            <path d={SPARK4} />
          </svg>
        </span>
      )}

      {isCover && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-coral py-0.5 text-center font-playful text-[9px] leading-tight text-white">
          {coverLabel}
        </span>
      )}

      {/* Remove (✕) — gated by `removable`, which already encodes the cover
          rule (composed covers have no cover thumb; legacy hides it on 0). */}
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          aria-label={removeLabel}
          className="absolute top-0.5 right-0.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/75 disabled:opacity-60"
        >
          {removing ? (
            // A single winking spark — the full three-star twinkle can't fit
            // inside this 20px disc.
            <svg
              viewBox="0 0 24 24"
              width={12}
              height={12}
              fill="currentColor"
              aria-hidden="true"
              className="wink-twinkle-star"
            >
              <path d={SPARK4} />
            </svg>
          ) : (
            <X className="h-3 w-3" strokeWidth={2.5} />
          )}
        </button>
      )}
    </div>
  );
}

/** The always-present "+" tile that opens the OS picker inline. */
function AddTile({ onClick, busy, label }: { onClick: () => void; busy: boolean; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      className="group flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-coral/40 bg-coral/[0.04] transition-colors hover:border-coral hover:bg-coral/[0.08] disabled:opacity-60"
    >
      {busy ? (
        <Storydust variant="twinkle" size="inline" />
      ) : (
        <ImagePlus className="h-5 w-5 text-coral transition-transform group-hover:scale-110" />
      )}
    </button>
  );
}

/**
 * A compact, drag-to-reorder horizontal strip of page thumbnails. The first
 * photo is the cover. Reordering commits immediately via onReorder. When a
 * bookId is supplied, a "+" tile appends photos (uploaded straight to the book,
 * which auto-refreshes perception) and each non-cover thumbnail gets an ✕ that
 * calls the page DELETE endpoint (respecting the cover + min-2 guards).
 */
export function PhotoStrip({
  photos,
  onReorder,
  bookId,
  onPhotosChanged,
  reading,
  hasPhotoCover = true,
}: PhotoStripProps) {
  const t = useTranslations('setup');
  const tUpload = useTranslations('upload');
  const { getToken } = useAuth();
  const [items, setItems] = useState<StripPhoto[]>(photos);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // X17 B1: sequential sparkle "read" sweep. Simulated pacing while reading;
  // when reading ends mid-pass the remaining thumbs finish fast, then the
  // sweep clears. Reduced motion opts out entirely.
  const SWEEP_STEP_MS = 1100;
  const SWEEP_FINISH_MS = 90;
  const reducedMotion = useReducedMotion() ?? false;
  const [sweepIndex, setSweepIndex] = useState<number | null>(null);
  const sweepActive = !!reading && !reducedMotion && items.length > 0;
  // Boolean (not the index) so the fast-finish pass doesn't restart its own
  // interval on every advance — the effect re-runs only when the sweep
  // finishes, which is what stops the idle 90ms timer.
  const sweepDone = sweepIndex === null;
  useEffect(() => {
    if (sweepActive) {
      setSweepIndex(0);
      const id = setInterval(() => {
        setSweepIndex((i) => ((i ?? 0) + 1) % Math.max(items.length, 1));
      }, SWEEP_STEP_MS);
      return () => clearInterval(id);
    }
    if (sweepDone) return; // Idle — no timer at all.
    // Arrival (or unmount of the reading state): fast-finish the pass.
    const id = setInterval(() => {
      setSweepIndex((i) => {
        if (i == null || i >= items.length - 1) return null;
        return i + 1;
      });
    }, SWEEP_FINISH_MS);
    return () => clearInterval(id);
  }, [sweepActive, sweepDone, items.length]);

  useEffect(() => {
    setItems(photos);
  }, [photos]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((p) => p.id === active.id);
    const newIndex = items.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    onReorder(next);
  };

  const remaining = Math.max(0, BOOK_CONSTRAINTS.MAX_PHOTOS - items.length);
  const canAdd = !!bookId && remaining > 0;

  const openPicker = useCallback(() => inputRef.current?.click(), []);

  const onInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      e.target.value = ''; // Allow re-picking the same file.
      if (!bookId || !fileList || fileList.length === 0) return;

      // Respect the cap and pre-validate. One bad file never sinks the batch.
      const picked = Array.from(fileList).slice(0, remaining);
      const valid = picked.filter((f) => {
        try {
          validateFile(f);
          return true;
        } catch {
          return false;
        }
      });
      const rejected = picked.length - valid.length;
      if (rejected > 0) toast.error(tUpload('errorWrongTypeSome', { count: rejected }));
      if (fileList.length > remaining)
        toast.error(tUpload('errorCapReached', { max: BOOK_CONSTRAINTS.MAX_PHOTOS }));
      if (valid.length === 0) return;

      setUploading(true);
      try {
        const assets = await uploadPhotos(
          valid.map((file) => ({ key: makeFileKey(), file })),
          { bookId, getToken },
        );
        if (assets.length < valid.length) {
          toast.error(tUpload('errorSomeFailed', { count: valid.length - assets.length }));
        }
        await onPhotosChanged?.();
      } catch (err) {
        logger.error({ err }, 'PhotoStrip inline upload failed');
        toast.error(tUpload('errorGeneric'));
      } finally {
        setUploading(false);
      }
    },
    [bookId, remaining, getToken, onPhotosChanged, tUpload],
  );

  const handleRemove = useCallback(
    async (photo: StripPhoto) => {
      if (!bookId) return;
      setRemovingId(photo.id);
      try {
        const token = await getToken();
        const res = await fetch(`/api/book/${bookId}/page/${photo.id}`, {
          method: 'DELETE',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          // Map the server's guard codes (cover / min-2) to friendly copy;
          // the raw message goes to the log, never to the parent.
          logger.warn({ body }, 'PhotoStrip page delete rejected');
          const friendly =
            body.code === 'COVER_LOCKED'
              ? t('coverLocked')
              : body.code === 'MIN_PAGES'
                ? t('minPages')
                : tUpload('errorGeneric');
          toast.error(friendly);
          return;
        }
        await onPhotosChanged?.();
      } catch (err) {
        logger.error({ err }, 'PhotoStrip page delete failed');
        toast.error(tUpload('errorGeneric'));
      } finally {
        setRemovingId(null);
      }
    },
    [bookId, getToken, onPhotosChanged, t, tUpload],
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((p) => p.id)} strategy={horizontalListSortingStrategy}>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {items.map((photo, idx) => {
            const flags = stripThumbFlags(idx, items.length, hasPhotoCover);
            return (
              <SortableThumb
                key={photo.id}
                photo={photo}
                isCover={flags.isCover}
                coverLabel={t('coverBadge')}
                removable={!!bookId && flags.removable}
                removing={removingId === photo.id}
                onRemove={() => void handleRemove(photo)}
                removeLabel={tUpload('remove')}
                sparkling={sweepIndex === idx}
              />
            );
          })}

          {canAdd && <AddTile onClick={openPicker} busy={uploading} label={tUpload('addPhotos')} />}
        </div>
      </SortableContext>

      {bookId && (
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
      )}
    </DndContext>
  );
}

export default PhotoStrip;
