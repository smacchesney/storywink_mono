'use client';

import React, { useRef, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Page, BookStatus } from '@prisma/client';
import { Loader2, AlertTriangle, Type, Heart, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { coolifyImageUrl } from '@storywink/shared';
import { buildDisplayPages, type DisplayPage } from './FlipbookViewer';

interface BookPageGalleryProps {
  pages: Page[];
  bookStatus: BookStatus;
  currentDisplayIndex: number; // 1-based index into displayPages
  onDisplayPageSelect: (displayIndex: number) => void; // 1-based
  childName?: string | null;
  bookTitle?: string;
}

const BookPageGallery: React.FC<BookPageGalleryProps> = ({
  pages,
  bookStatus,
  currentDisplayIndex,
  onDisplayPageSelect,
  childName,
  bookTitle,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeThumbRef = useRef<HTMLButtonElement>(null);

  // Build interleaved display pages (same logic as FlipbookViewer)
  const displayPages = useMemo(
    () => buildDisplayPages(pages, { childName, bookTitle }),
    [pages, childName, bookTitle]
  );

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
  }, [currentDisplayIndex]);

  /** Get the aria-label for a display page */
  const getAriaLabel = (dp: DisplayPage, isActive: boolean): string => {
    if (dp.type === 'dedication') return `Dedication page${isActive ? ' (current)' : ''}`;
    if (dp.type === 'back-cover') return `Back cover${isActive ? ' (current)' : ''}`;
    return `${dp.type === 'text' ? 'Text' : 'Illustration'} - Page ${dp.page.pageNumber}${isActive ? ' (current)' : ''}`;
  };

  /** Get the thumbnail label for a display page */
  const getThumbLabel = (dp: DisplayPage): string => {
    if (dp.type === 'dedication') return '\u2764';
    if (dp.type === 'back-cover') return 'Back';
    return `${dp.page.pageNumber}${dp.type === 'text' ? 'T' : ''}`;
  };

  /** Get a unique key for each display page */
  const getKey = (dp: DisplayPage, index: number): string => {
    if (dp.type === 'dedication') return `dedication-${index}`;
    if (dp.type === 'back-cover') return `back-cover-${index}`;
    return `${dp.page.id}-${dp.type}-${index}`;
  };

  return (
    <div className="w-full py-2" aria-label="Page gallery">
      <div
        ref={scrollContainerRef}
        className="flex px-4 py-2 gap-3 overflow-x-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent snap-x snap-mandatory mx-auto"
        style={{ scrollbarWidth: 'thin' }}
      >
        {/* Spacer at the start to prevent first thumbnail border clipping */}
        <div className="flex-shrink-0 w-1"></div>

        {displayPages.map((dp, index) => {
          const displayIndex = index + 1; // 1-based
          const isActive = displayIndex === currentDisplayIndex;

          // For text/illustration pages, check loading state
          const hasPage = dp.type === 'text' || dp.type === 'illustration';
          const hasImage = hasPage && !!dp.page.generatedImageUrl;
          const isPending = hasPage && !hasImage && bookStatus === BookStatus.ILLUSTRATING;
          const isFailed = hasPage && !hasImage && bookStatus === BookStatus.FAILED;

          return (
            <div
              key={getKey(dp, index)}
              className={cn(
                'flex-shrink-0 snap-center',
                'w-16 h-16 sm:w-18 sm:h-18 md:w-20 md:h-20',
                isActive ? 'p-1' : 'p-0.5'
              )}
            >
              <button
                ref={isActive ? activeThumbRef : null}
                type="button"
                onClick={() => onDisplayPageSelect(displayIndex)}
                disabled={dp.type === 'illustration' && (isPending || isFailed)}
                className={cn(
                  'w-full h-full relative rounded-md overflow-hidden',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F76C5E] focus-visible:ring-offset-2',
                  'touch-manipulation',
                  isActive
                    ? 'ring-2 ring-[#F76C5E] shadow-md transition-all duration-200 ease-in-out'
                    : 'ring-1 ring-muted/40 hover:ring-[#F76C5E]/50 transition-all duration-150',
                  (dp.type === 'illustration' && (isPending || isFailed)) && 'cursor-default'
                )}
                aria-label={getAriaLabel(dp, isActive)}
                aria-current={isActive}
                style={{
                  transform: isActive ? 'scale(1.05)' : 'scale(1)',
                  transformOrigin: 'center center',
                }}
              >
                {dp.type === 'dedication' ? (
                  // Dedication page thumbnail
                  <div className="w-full h-full bg-white flex items-center justify-center">
                    <Heart className="h-5 w-5 text-[#F76C5E]" />
                  </div>
                ) : dp.type === 'back-cover' ? (
                  // Back cover thumbnail
                  <div className="w-full h-full bg-[#F76C5E] flex items-center justify-center">
                    <BookOpen className="h-5 w-5 text-white" />
                  </div>
                ) : dp.type === 'text' ? (
                  // Text page thumbnail - white with text icon
                  <div className="w-full h-full bg-white flex items-center justify-center">
                    <Type className="h-5 w-5 text-[#1a1a1a]/60" />
                  </div>
                ) : hasImage ? (
                  <Image
                    src={coolifyImageUrl(dp.page.generatedImageUrl!)}
                    alt={`Page ${dp.page.pageNumber}`}
                    fill
                    sizes="(max-width: 768px) 64px, 80px"
                    className={cn(
                      "object-cover",
                      !isActive && "hover:opacity-90 transition-opacity"
                    )}
                  />
                ) : isPending ? (
                   <div className="w-full h-full bg-muted flex items-center justify-center" title="Illustration pending">
                     <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                   </div>
                ) : isFailed ? (
                   <div className="w-full h-full bg-destructive/10 flex items-center justify-center" title="Illustration failed">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                   </div>
                ) : null}

                <div className={cn(
                  "absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] py-0.5 font-medium text-center",
                  isActive && "bg-[#F76C5E]/80"
                )}>
                   {getThumbLabel(dp)}
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
