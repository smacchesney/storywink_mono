"use client";

import React, { useEffect, useState } from 'react';
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
import { useTranslations } from 'next-intl';
import { optimizeCloudinaryUrl } from '@storywink/shared';

export interface StripPhoto {
  id: string;
  thumbnailUrl: string | null;
  url: string | null;
}

interface PhotoStripProps {
  photos: StripPhoto[];
  /** Fires with the reordered array (in new page order) after a drag. */
  onReorder: (photos: StripPhoto[]) => void;
}

function SortableThumb({
  photo,
  isCover,
  coverLabel,
}: {
  photo: StripPhoto;
  isCover: boolean;
  coverLabel: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: photo.id });

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
      {...attributes}
      {...listeners}
      className="relative shrink-0 h-16 w-16 rounded-xl overflow-hidden border border-black/5 shadow-sm cursor-grab active:cursor-grabbing bg-gray-100"
    >
      {src ? (
        <Image
          src={optimizeCloudinaryUrl(src)}
          alt=""
          fill
          sizes="64px"
          className="object-cover pointer-events-none"
        />
      ) : null}
      {isCover && (
        <span className="absolute bottom-0 inset-x-0 bg-[#F76C5E] text-white text-[9px] leading-tight font-playful text-center py-0.5">
          {coverLabel}
        </span>
      )}
    </div>
  );
}

/**
 * A compact, drag-to-reorder horizontal strip of page thumbnails. The first
 * photo is the cover. Reordering commits immediately via onReorder (which the
 * setup page maps to POST /reorder).
 */
export function PhotoStrip({ photos, onReorder }: PhotoStripProps) {
  const t = useTranslations('setup');
  const [items, setItems] = useState<StripPhoto[]>(photos);

  useEffect(() => {
    setItems(photos);
  }, [photos]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
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

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((p) => p.id)} strategy={horizontalListSortingStrategy}>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {items.map((photo, idx) => (
            <SortableThumb
              key={photo.id}
              photo={photo}
              isCover={idx === 0}
              coverLabel={t('coverBadge')}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

export default PhotoStrip;
