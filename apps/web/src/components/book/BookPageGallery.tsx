'use client';

import React, { useRef, useEffect, useMemo } from 'react';
import { Page, BookStatus } from '@prisma/client';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Type, Heart, BookOpen, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Storydust } from '@/components/ui/storydust';
import BookArtImage from './BookArtImage';
import { buildDisplayPages, type BookLayout, type DisplayPage } from './display-pages';

interface BookPageGalleryProps {
  pages: Page[];
  bookStatus: BookStatus;
  currentDisplayIndex: number; // 1-based index into displayPages
  onDisplayPageSelect: (displayIndex: number) => void; // 1-based
  childName?: string | null;
  bookTitle?: string;
  language?: string;
  /** Must match the flipbook's active layout so indices line up. */
  layout?: BookLayout;
}

const BookPageGallery: React.FC<BookPageGalleryProps> = ({
  pages,
  bookStatus,
  currentDisplayIndex,
  onDisplayPageSelect,
  childName,
  bookTitle,
  language,
  layout = 'spread',
}) => {
  const t = useTranslations('preview');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeThumbRef = useRef<HTMLButtonElement>(null);

  // Build interleaved display pages (same logic as FlipbookViewer)
  const displayPages = useMemo(
    () => buildDisplayPages(pages, { childName, bookTitle, language, layout }),
    [pages, childName, bookTitle, language, layout],
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
      const centerPosition = thumbLeft - containerWidth / 2 + thumbWidth / 2;

      // Smooth scroll to position
      container.scrollTo({
        left: centerPosition,
        behavior: 'smooth',
      });
    }
  }, [currentDisplayIndex]);

  // Filter out blank pages but keep original indices for navigation
  const galleryPages = useMemo(
    () =>
      displayPages
        .map((dp, index) => ({ dp, originalIndex: index }))
        .filter(({ dp }) => dp.type !== 'blank'),
    [displayPages],
  );

  /** Get the aria-label for a display page */
  const getAriaLabel = (dp: DisplayPage<Page>, isActive: boolean): string => {
    if (dp.type === 'blank') return `Blank page${isActive ? ' (current)' : ''}`;
    if (dp.type === 'dedication') return `Dedication page${isActive ? ' (current)' : ''}`;
    if (dp.type === 'ending') return `Ending page${isActive ? ' (current)' : ''}`;
    if (dp.type === 'back-cover') return `Back cover${isActive ? ' (current)' : ''}`;
    if (dp.type === 'collage') return `Photo collage${isActive ? ' (current)' : ''}`;
    if (dp.type === 'story') return `Page ${dp.page.pageNumber}${isActive ? ' (current)' : ''}`;
    return `${dp.type === 'text' ? 'Text' : 'Illustration'} - Page ${dp.page.pageNumber}${isActive ? ' (current)' : ''}`;
  };

  /** Get the thumbnail label for a display page */
  const getThumbLabel = (dp: DisplayPage<Page>): string => {
    if (dp.type === 'blank') return '';
    if (dp.type === 'dedication') return '❤';
    if (dp.type === 'ending') return 'End';
    if (dp.type === 'back-cover') return 'Back';
    if (dp.type === 'collage') return '📷';
    if (dp.type === 'story') return `${dp.page.pageNumber}`;
    return `${dp.page.pageNumber}${dp.type === 'text' ? 'T' : ''}`;
  };

  /** Get a unique key for each display page */
  const getKey = (dp: DisplayPage<Page>, index: number): string => {
    if (dp.type === 'blank') return `blank-${index}`;
    if (dp.type === 'dedication') return `dedication-${index}`;
    if (dp.type === 'ending') return `ending-${index}`;
    if (dp.type === 'back-cover') return `back-cover-${index}`;
    if (dp.type === 'collage') return `collage-${dp.seq}-${index}`;
    return `${dp.page.id}-${dp.type}-${index}`;
  };

  return (
    <div className="w-full py-2" aria-label="Page gallery">
      <div
        ref={scrollContainerRef}
        className="scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent mx-auto flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-2"
        style={{ scrollbarWidth: 'thin' }}
      >
        {/* Spacer at the start to prevent first thumbnail border clipping */}
        <div className="w-1 flex-shrink-0"></div>

        {galleryPages.map(({ dp, originalIndex }) => {
          const displayIndex = originalIndex + 1; // 1-based, matches flipbook indexing
          const isActive = displayIndex === currentDisplayIndex;

          // For text/illustration/story pages, check loading state
          const hasPage = dp.type === 'text' || dp.type === 'illustration' || dp.type === 'story';
          const hasArt = dp.type === 'illustration' || dp.type === 'story';
          const hasImage = hasPage && !!dp.page.generatedImageUrl;
          const isPending = hasPage && !hasImage && bookStatus === BookStatus.ILLUSTRATING;
          const isFailed = hasPage && !hasImage && bookStatus === BookStatus.FAILED;

          return (
            <div
              key={getKey(dp, originalIndex)}
              className={cn(
                'flex-shrink-0 snap-center',
                'h-16 w-16 sm:h-18 sm:w-18 md:h-20 md:w-20',
                isActive ? 'p-1' : 'p-0.5',
              )}
            >
              <button
                ref={isActive ? activeThumbRef : null}
                type="button"
                onClick={() => onDisplayPageSelect(displayIndex)}
                disabled={hasArt && (isPending || isFailed)}
                className={cn(
                  'relative h-full w-full overflow-hidden rounded-md',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2',
                  'touch-manipulation',
                  isActive
                    ? 'shadow-md ring-2 ring-coral transition-all duration-200 ease-in-out'
                    : 'ring-1 ring-muted/40 transition-all duration-150 hover:ring-coral/50',
                  hasArt && (isPending || isFailed) && 'cursor-default',
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
                  <div className="flex h-full w-full items-center justify-center bg-white">
                    <Heart className="h-5 w-5 text-coral" />
                  </div>
                ) : dp.type === 'ending' ? (
                  // Ending page thumbnail
                  <div className="flex h-full w-full items-center justify-center bg-white">
                    <Star className="h-5 w-5 text-coral" />
                  </div>
                ) : dp.type === 'back-cover' ? (
                  // Back cover thumbnail
                  <div className="flex h-full w-full items-center justify-center bg-white">
                    <BookOpen className="h-5 w-5 text-[#1a1a1a]/60" />
                  </div>
                ) : dp.type === 'text' ? (
                  // Text page thumbnail - white with text icon
                  <div className="flex h-full w-full items-center justify-center bg-white">
                    <Type className="h-5 w-5 text-[#1a1a1a]/60" />
                  </div>
                ) : hasImage ? (
                  <BookArtImage
                    src={dp.page.generatedImageUrl!}
                    alt={`Page ${dp.page.pageNumber}`}
                    sizes="(max-width: 768px) 64px, 80px"
                    className={cn(!isActive && 'transition-opacity hover:opacity-90')}
                  />
                ) : isPending ? (
                  <div className="flex h-full w-full items-center justify-center bg-coral-soft/50">
                    <Storydust variant="twinkle" size="inline" label={t('pageCooking')} />
                  </div>
                ) : isFailed ? (
                  <div
                    className="flex h-full w-full items-center justify-center bg-destructive/10"
                    title="Illustration failed"
                  >
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  </div>
                ) : null}

                <div
                  className={cn(
                    'absolute right-0 bottom-0 left-0 bg-black/50 py-0.5 text-center text-[10px] font-medium text-white',
                    isActive && 'bg-coral/80',
                  )}
                >
                  {getThumbLabel(dp)}
                </div>
              </button>
            </div>
          );
        })}

        {/* Spacer at the end to prevent last thumbnail border clipping */}
        <div className="w-1 flex-shrink-0"></div>
      </div>
    </div>
  );
};

export default BookPageGallery;
