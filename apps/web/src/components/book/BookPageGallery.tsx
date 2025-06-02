'use client';

import React, { useRef, useEffect } from 'react';
import Image from 'next/image';
import { Page, BookStatus } from '@prisma/client';
import { Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils'; // Assuming you have a utility for class names

interface BookPageGalleryProps {
  pages: Page[];
  bookStatus: BookStatus;
  currentPageNumber: number;
  onPageSelect: (pageNumber: number) => void;
}

const BookPageGallery: React.FC<BookPageGalleryProps> = ({
  pages,
  bookStatus,
  currentPageNumber,
  onPageSelect,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeThumbRef = useRef<HTMLButtonElement>(null);

  // Scroll active thumbnail into view when it changes
  useEffect(() => {
    if (activeThumbRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const thumb = activeThumbRef.current;
      
      // Calculate position to scroll the active thumbnail to center
      const containerWidth = container.offsetWidth;
      const thumbLeft = thumb.offsetLeft;
      const thumbWidth = thumb.offsetWidth;
      const centerPosition = thumbLeft - (containerWidth / 2) + (thumbWidth / 2);
      
      // Smooth scroll to position
      container.scrollTo({
        left: centerPosition,
        behavior: 'smooth'
      });
    }
  }, [currentPageNumber]);

  return (
    <div className="w-full py-2" aria-label="Page gallery">
      <div 
        ref={scrollContainerRef}
        className="flex px-4 py-2 gap-3 overflow-x-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent snap-x snap-mandatory mx-auto"
        style={{ scrollbarWidth: 'thin' }}
      >
        {/* Spacer at the start to prevent first thumbnail border clipping */}
        <div className="flex-shrink-0 w-1"></div>
        
        {pages.map((page) => {
          const isActive = page.pageNumber === currentPageNumber;
          const hasImage = !!page.generatedImageUrl;
          const isPending = !hasImage && bookStatus === BookStatus.ILLUSTRATING;
          const isFailed = !hasImage && bookStatus === BookStatus.FAILED;

          return (
            <div
              key={page.id}
              className={cn(
                'flex-shrink-0 snap-center',
                'w-16 h-16 sm:w-18 sm:h-18 md:w-20 md:h-20',
                isActive ? 'p-1' : 'p-0.5' // More padding for the active item
              )}
            >
              <button
                ref={isActive ? activeThumbRef : null}
                type="button"
                onClick={() => onPageSelect(page.pageNumber)}
                disabled={isPending || isFailed}
                className={cn(
                  'w-full h-full relative rounded-md overflow-hidden',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F76C5E] focus-visible:ring-offset-2',
                  'touch-manipulation', // Improves touch response
                  isActive 
                    ? 'ring-2 ring-[#F76C5E] shadow-md transition-all duration-200 ease-in-out' 
                    : 'ring-1 ring-muted/40 hover:ring-[#F76C5E]/50 transition-all duration-150',
                  (isPending || isFailed) && 'cursor-default'
                )}
                aria-label={`Page ${page.pageNumber}${isActive ? ' (current)' : ''}`}
                aria-current={isActive}
                style={{
                  transform: isActive ? 'scale(1.05)' : 'scale(1)',
                  transformOrigin: 'center center',
                }}
              >
                {hasImage && (
                  <Image
                    src={page.generatedImageUrl!}
                    alt={`Page ${page.pageNumber}`}
                    fill
                    sizes="(max-width: 768px) 64px, 80px"
                    className={cn(
                      "object-cover",
                      !isActive && "hover:opacity-90 transition-opacity"
                    )}
                  />
                )}

                {isPending && (
                   <div className="w-full h-full bg-muted flex items-center justify-center" title="Illustration pending">
                     <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                   </div>
                )}

                {isFailed && (
                   <div className="w-full h-full bg-destructive/10 flex items-center justify-center" title="Illustration failed">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                   </div>
                )}

                <div className={cn(
                  "absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] py-0.5 font-medium text-center",
                  isActive && "bg-[#F76C5E]/80"
                )}>
                   {page.pageNumber}
                </div>
              </button>
            </div>
          );
        })}

        {/* Spacer at the end to prevent last thumbnail border clipping */}
        <div className="flex-shrink-0 w-1"></div>
      </div>
    </div>
  );
};

export default BookPageGallery; 