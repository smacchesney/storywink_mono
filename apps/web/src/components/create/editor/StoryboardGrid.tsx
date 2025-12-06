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
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy, // Or verticalListSortingStrategy if simpler layout needed first
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Image from 'next/image';
import { GripVertical } from 'lucide-react';
import { StoryboardPage, optimizeCloudinaryUrl } from '@storywink/shared';
import { cn } from '@/lib/utils';

interface StoryboardGridProps {
  pages: StoryboardPage[];
  onOrderChange: (newPages: StoryboardPage[]) => void;
}

// Individual Sortable Item Component
function SortablePageItem({ id, page, visualIndex }: { id: string; page: StoryboardPage; visualIndex: number }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef, // For drag handle
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative aspect-square bg-gray-200 rounded overflow-hidden shadow",
        "hover:shadow-lg",
        "transition-shadow",
        "duration-200",
        "ease-in-out",
        isDragging && "ring-2 ring-[#F76C5E]"
      )}
    >
      {/* Drag Handle - only this receives drag listeners */}
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className={cn(
          "absolute top-1 left-1 p-1.5 rounded z-10",
          "bg-white/90 shadow-sm",
          "cursor-grab active:cursor-grabbing",
          "touch-none", // Prevents touch scrolling on the handle
          "select-none", // Prevent text selection
          "[-webkit-touch-callout:none]", // Prevent iOS callout menu on long-press
          "hover:bg-white hover:shadow-md",
          "transition-all duration-150"
        )}
        aria-label={`Drag to reorder page ${visualIndex + 1}`}
      >
        <GripVertical className="h-4 w-4 text-gray-500" />
      </button>

      {/* Use thumbnail, fallback to full url with optimization */}
      {page.asset?.thumbnailUrl || page.asset?.url ? (
        <Image
          src={page.asset.thumbnailUrl || optimizeCloudinaryUrl(page.asset.url)}
          alt={`Page ${visualIndex + 1}`}
          fill
          sizes="(max-width: 768px) 33vw, 120px"
          style={{ objectFit: "cover" }}
          className="pointer-events-none"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">No Thumb</div>
      )}
      {/* Page Number Overlay - Updated Style */}
      <div
        className={cn(
          "absolute bottom-1 right-1 rounded-sm px-1.5 py-0.5", // Base positioning and padding
          "bg-[#F76C5E] text-white", // Coral background, white text
          "text-[10px] font-medium leading-none" // Font styling
        )}
      >
        Pg. {visualIndex + 1} {/* Added "Pg. " prefix */}
      </div>
    </div>
  );
}

// Main Storyboard Component
export function StoryboardGrid({ pages, onOrderChange }: StoryboardGridProps) {
  const [items, setItems] = useState<StoryboardPage[]>(pages);

  // Debug logging
  useEffect(() => {
    console.log('StoryboardGrid received pages:', pages);
    console.log('Pages length:', pages.length);
    if (pages.length > 0) {
      console.log('First page asset:', pages[0].asset);
      console.log('All pages have assets:', pages.every(p => p.asset));
    }
  }, [pages]);

  // Update internal state if external pages prop changes
  useEffect(() => {
    setItems(pages);
  }, [pages]);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      // Require mouse to move 10px before activating drag
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(TouchSensor, {
      // Distance-based activation - start drag after moving 10px
      // This avoids conflicts with iOS long-press gestures (zoom, text selection)
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setItems((currentItems) => {
        const oldIndex = currentItems.findIndex((item) => item.id === active.id);
        const newIndex = currentItems.findIndex((item) => item.id === over.id);
        
        const newOrderedItems = arrayMove(currentItems, oldIndex, newIndex);
        
        // Update pageNumber and index based on new order
        const finalItems = newOrderedItems.map((item, index) => ({
            ...item,
            index: index,
            pageNumber: index + 1,
            // Potentially update isTitlePage here if needed, though cover logic might be separate
            isTitlePage: index === 0 
        }));

        onOrderChange(finalItems); // Notify parent of the final order
        return finalItems; // Update local state
      });
    }
  }

  // Separate the cover page (assuming index 0 is cover initially - adjust if needed)
  // This filtering should ideally happen in the PARENT component based on coverAssetId
  // but we handle it here temporarily for layout demonstration.
  // const coverPage = items.find(p => p.isTitlePage); 
  // const storyPages = items.filter(p => !p.isTitlePage);
  
  // For now, assume items are already filtered non-cover pages from parent
  // const items = pages; 

  // Haptic feedback on drag start
  const handleDragStart = () => {
    if (window.navigator.vibrate) {
      window.navigator.vibrate(50); // Brief 50ms haptic feedback
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* We need one SortableContext containing ALL draggable items */}
      <SortableContext 
        items={items.map(item => item.id)} 
        strategy={rectSortingStrategy} 
      >
        <div className="p-2">
           <div className="grid grid-cols-3 gap-2">
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
    </DndContext>
  );
}

export default StoryboardGrid; 