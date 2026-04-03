"use client";

import React, { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { GripVertical } from 'lucide-react';
import { StoryboardPage, optimizeCloudinaryUrl } from '@storywink/shared';
import { cn } from '@/lib/utils';

interface StoryboardGridProps {
  pages: StoryboardPage[];
  onOrderChange: (newPages: StoryboardPage[]) => void;
}

// Individual Sortable Item Component
function SortablePageItem({ id, page, visualIndex }: { id: string; page: StoryboardPage; visualIndex: number }) {
  const t = useTranslations('editor');
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative aspect-square bg-gray-200 rounded overflow-hidden shadow",
        "hover:shadow-lg transition-shadow duration-200 ease-in-out",
        "select-none [-webkit-touch-callout:none]",
        isDragging && "opacity-30"
      )}
      {...attributes}
    >
      {/* Drag handle — only this element activates drag */}
      <button
        ref={setActivatorNodeRef}
        {...listeners}
        className={cn(
          "absolute top-1 left-1 z-10",
          "w-7 h-7 rounded-md",
          "bg-black/30 backdrop-blur-sm",
          "flex items-center justify-center",
          "touch-none cursor-grab active:cursor-grabbing",
          "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity"
        )}
        aria-label={t('dragHandle')}
      >
        <GripVertical className="size-4 text-white/80" />
      </button>

      {/* Thumbnail image */}
      {page.asset?.thumbnailUrl || page.asset?.url ? (
        <Image
          src={page.asset.thumbnailUrl || optimizeCloudinaryUrl(page.asset.url)}
          alt={t('pageAlt', { n: visualIndex + 1 })}
          fill
          sizes="(max-width: 768px) 33vw, 120px"
          style={{ objectFit: "cover" }}
          className="pointer-events-none"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">{t('noThumb')}</div>
      )}
      {/* Page Number Overlay */}
      <div
        className={cn(
          "absolute bottom-1 right-1 rounded-sm px-1.5 py-0.5",
          "bg-[#F76C5E] text-white",
          "text-[10px] font-medium leading-none"
        )}
      >
        {t('pageLabel', { n: visualIndex + 1 })}
      </div>
    </div>
  );
}

// Thumbnail clone rendered inside DragOverlay
function DragOverlayItem({ page, visualIndex }: { page: StoryboardPage; visualIndex: number }) {
  const t = useTranslations('editor');
  return (
    <div className="relative aspect-square bg-gray-200 rounded overflow-hidden shadow-xl ring-2 ring-[#F76C5E] rotate-[2deg]">
      {page.asset?.thumbnailUrl || page.asset?.url ? (
        <Image
          src={page.asset.thumbnailUrl || optimizeCloudinaryUrl(page.asset.url)}
          alt={t('pageAlt', { n: visualIndex + 1 })}
          fill
          sizes="120px"
          style={{ objectFit: "cover" }}
          className="pointer-events-none"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">{t('noThumb')}</div>
      )}
      <div
        className={cn(
          "absolute bottom-1 right-1 rounded-sm px-1.5 py-0.5",
          "bg-[#F76C5E] text-white",
          "text-[10px] font-medium leading-none"
        )}
      >
        {t('pageLabel', { n: visualIndex + 1 })}
      </div>
    </div>
  );
}

// Main Storyboard Component
export function StoryboardGrid({ pages, onOrderChange }: StoryboardGridProps) {
  const [items, setItems] = useState<StoryboardPage[]>(pages);
  const [activeItem, setActiveItem] = useState<{ page: StoryboardPage; index: number } | null>(null);

  // Update internal state if external pages prop changes
  useEffect(() => {
    setItems(pages);
  }, [pages]);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      // Press-and-hold on the grip handle before drag starts
      activationConstraint: { delay: 150, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragStart(event: DragStartEvent) {
    const index = items.findIndex(p => p.id === event.active.id);
    if (index !== -1) {
      setActiveItem({ page: items[index], index });
    }
    if (window.navigator.vibrate) {
      window.navigator.vibrate(50);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveItem(null);
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setItems((currentItems) => {
        const oldIndex = currentItems.findIndex((item) => item.id === active.id);
        const newIndex = currentItems.findIndex((item) => item.id === over.id);

        const newOrderedItems = arrayMove(currentItems, oldIndex, newIndex);

        const finalItems = newOrderedItems.map((item, index) => ({
            ...item,
            index: index,
            pageNumber: index + 1,
        }));

        onOrderChange(finalItems);
        return finalItems;
      });
    }
  }

  function handleDragCancel() {
    setActiveItem(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={items.map(item => item.id)}
        strategy={rectSortingStrategy}
      >
        <div className="p-2">
           <div className="grid grid-cols-3 gap-3">
            {items.map((page, index) => (
              <SortablePageItem
                key={page.id}
                id={page.id}
                page={page}
                visualIndex={index}
              />
            ))}
          </div>
        </div>
      </SortableContext>
      <DragOverlay adjustScale={false}>
        {activeItem ? (
          <DragOverlayItem page={activeItem.page} visualIndex={activeItem.index} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default StoryboardGrid; 