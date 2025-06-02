"use client";

import React, { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
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
import { StoryboardPage } from '@/shared/types';
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
      {...attributes} 
      {...listeners}
      className={cn(
        "relative aspect-square bg-gray-200 rounded overflow-hidden shadow touch-manipulation",
        "hover:shadow-lg",
        "transition-shadow",
        "duration-200",
        "ease-in-out"
      )}
    >
      {/* Use thumbnail, fallback to full url */}
      {page.asset?.thumbnailUrl || page.asset?.url ? (
        <Image 
          src={page.asset.thumbnailUrl || page.asset.url}
          alt={`Page ${visualIndex + 1}`}
          fill
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
    useSensor(PointerSensor),
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

  return (
    <DndContext 
      sensors={sensors}
      collisionDetection={closestCenter}
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