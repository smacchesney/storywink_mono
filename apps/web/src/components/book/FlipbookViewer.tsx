'use client';

import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle, useMemo } from 'react';
import HTMLFlipBook from 'react-pageflip';
import { Page } from '@prisma/client';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { coolifyImageUrl } from '@storywink/shared';

// Mascot URLs
const DEDICATION_MASCOT_URL = 'https://res.cloudinary.com/storywink/image/upload/v1772291377/Screenshot_2026-02-28_at_10.58.09_PM_gnknk5.png';
const ENDING_MASCOT_URL = 'https://res.cloudinary.com/storywink/image/upload/v1772291378/Screenshot_2026-02-28_at_10.57.54_PM_sxcasb.png';
const BACK_COVER_MASCOT_URL = 'https://res.cloudinary.com/storywink/image/upload/v1772291378/Screenshot_2026-02-28_at_10.57.29_PM_qwoqr0.png';

// Display page types for interleaved layout
export type DisplayPage =
  | { type: 'illustration'; page: Page }
  | { type: 'text'; page: Page }
  | { type: 'dedication'; childName: string | null; bookTitle: string }
  | { type: 'ending'; childName: string | null; bookTitle: string }
  | { type: 'back-cover' };

export interface BuildDisplayPagesOptions {
  childName?: string | null;
  bookTitle?: string;
}

interface FlipbookViewerProps {
  pages: Page[];
  initialPageNumber?: number;
  onPageChange?: (displayIndex: number) => void;
  className?: string;
  childName?: string | null;
  bookTitle?: string;
}

// Define the type for the imperative handle
export interface FlipbookActions {
  pageFlip: () => any; // Expose the pageFlip API instance
}

/**
 * Build interleaved display pages:
 * - Title pages → just illustration (cover)
 * - Dedication page → after title
 * - Story pages → text page, then illustration page
 * - Back cover → at the end
 */
export function buildDisplayPages(pages: Page[], options?: BuildDisplayPagesOptions): DisplayPage[] {
  const displayPages: DisplayPage[] = [];
  for (const page of pages) {
    if (page.isTitlePage) {
      displayPages.push({ type: 'illustration', page });
      // Add dedication page right after the title/cover
      displayPages.push({
        type: 'dedication',
        childName: options?.childName ?? null,
        bookTitle: options?.bookTitle ?? 'You',
      });
    } else {
      displayPages.push({ type: 'text', page });
      displayPages.push({ type: 'illustration', page });
    }
  }
  // Add ending page before back cover
  displayPages.push({
    type: 'ending',
    childName: options?.childName ?? null,
    bookTitle: options?.bookTitle ?? 'You',
  });
  // Add back cover as the last page
  displayPages.push({ type: 'back-cover' });
  return displayPages;
}

// Use forwardRef to allow passing ref from parent
const FlipbookViewer = forwardRef<FlipbookActions, FlipbookViewerProps>((
  {
    pages,
    initialPageNumber = 1,
    onPageChange,
    className,
    childName,
    bookTitle,
  },
  ref // Receive the forwarded ref
) => {
  const flipBookInternalRef = useRef<any>(null);
  const [containerDimensions, setContainerDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null); // Ref for the container div

  // Build interleaved display pages
  const displayPages = useMemo(
    () => buildDisplayPages(pages, { childName, bookTitle }),
    [pages, childName, bookTitle]
  );

  // Expose the pageFlip instance via the forwarded ref
  useImperativeHandle(ref, () => ({
    pageFlip: () => flipBookInternalRef.current?.pageFlip(),
  }));

  // Adjust size based on container for responsiveness
  useEffect(() => {
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) {
        setContainerDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Calculate optimal dimensions based on container
  const calculateBookDimensions = () => {
    const { width, height } = containerDimensions;
    const padding = 32; // Total padding to account for
    const availableWidth = width - padding;
    const availableHeight = height - padding;

    // Smart adaptive logic for single vs double page view
    const aspectRatio = width / height;
    const isExtremeAspectRatio = aspectRatio > 2.5;
    const hasMinimumHeight = height >= 500;
    const shouldShowSpread = width >= 640 && hasMinimumHeight && !isExtremeAspectRatio;

    // For single page view (mobile portrait, landscape with limited height)
    if (!shouldShowSpread) {
      // Use most of available width/height, maintaining aspect ratio
      const pageWidth = availableWidth;
      const pageHeight = availableHeight;
      const pageAspectRatio = 0.77; // Typical book page aspect ratio (1:1.3)

      let finalWidth = pageWidth;
      let finalHeight = pageHeight;

      // Adjust to maintain aspect ratio
      if (pageWidth / pageHeight > pageAspectRatio) {
        finalWidth = pageHeight * pageAspectRatio;
      } else {
        finalHeight = pageWidth / pageAspectRatio;
      }

      return {
        width: Math.floor(finalWidth),
        height: Math.floor(finalHeight),
        isPortrait: true
      };
    }

    // For desktop/tablet (double page spread view)
    const spreadAspectRatio = 1.54; // Double page spread (2:1.3)
    let spreadWidth = availableWidth;
    let spreadHeight = availableHeight;

    if (spreadWidth / spreadHeight > spreadAspectRatio) {
      spreadWidth = spreadHeight * spreadAspectRatio;
    } else {
      spreadHeight = spreadWidth / spreadAspectRatio;
    }

    const pageWidth = Math.floor(spreadWidth / 2);
    const pageHeight = Math.floor(spreadHeight);

    return {
      width: pageWidth,
      height: pageHeight,
      isPortrait: false
    };
  };

  const { width: pageWidth, height: pageHeight, isPortrait } =
    containerDimensions.width > 0 ? calculateBookDimensions() : { width: 0, height: 0, isPortrait: false };

  // Handler for page flip event from the library
  const handleFlip = useCallback((e: any) => {
    const currentPage = e.data;
    if (onPageChange) {
      onPageChange(currentPage + 1); // Library is 0-indexed
    }
  }, [onPageChange]);

  // Add onInit handler to turn to initial page once ready
  const handleInit = useCallback(() => {
     if (flipBookInternalRef.current && initialPageNumber) {
        const pageIndex = Math.max(0, Math.min(initialPageNumber - 1, displayPages.length - 1));
            try {
               flipBookInternalRef.current?.pageFlip()?.turnToPage(pageIndex);
            } catch (e) {
               console.error("Error turning page on init:", e);
            }
     }
  }, [initialPageNumber, displayPages.length]);

  /** Render a single display page */
  const renderDisplayPage = (dp: DisplayPage, index: number) => {
    if (dp.type === 'dedication') {
      const displayName = dp.childName || dp.bookTitle || 'You';
      return (
        <div key={`dedication-${index}`} className="bg-white border border-gray-200 flex flex-col justify-center items-center overflow-hidden relative">
          <div className="text-center px-[10%]">
            <p className="font-playful text-[#1a1a1a] leading-relaxed"
               style={{ fontSize: 'clamp(14px, 3vw, 22px)' }}>
              This book was made<br />especially for
            </p>
            <p className="font-playful text-[#F76C5E] font-bold mt-1"
               style={{ fontSize: 'clamp(20px, 5vw, 36px)' }}>
              {displayName}
            </p>
          </div>
          <Image
            src={DEDICATION_MASCOT_URL}
            alt="Storywink mascot"
            width={200}
            height={200}
            className="absolute object-contain"
            style={{ bottom: '6%', right: '6%', height: '15%', width: 'auto' }}
          />
        </div>
      );
    }

    if (dp.type === 'ending') {
      const displayName = dp.childName || dp.bookTitle || 'You';
      return (
        <div key={`ending-${index}`} className="bg-white border border-gray-200 flex flex-col justify-center items-center overflow-hidden">
          <div className="text-center px-[10%]">
            <p className="font-playful text-[#1a1a1a] font-bold"
               style={{ fontSize: 'clamp(22px, 5vw, 38px)' }}>
              The End
            </p>
            <p className="font-playful text-[#1a1a1a] mt-2 leading-relaxed"
               style={{ fontSize: 'clamp(14px, 3vw, 22px)' }}>
              Until next time,
            </p>
            <p className="font-playful text-[#F76C5E] font-bold mt-1"
               style={{ fontSize: 'clamp(20px, 5vw, 36px)' }}>
              {displayName}!
            </p>
          </div>
          <Image
            src={ENDING_MASCOT_URL}
            alt="Storywink mascot"
            width={200}
            height={200}
            className="mt-4 object-contain"
            style={{ height: '15%', width: 'auto' }}
          />
        </div>
      );
    }

    if (dp.type === 'back-cover') {
      return (
        <div key={`back-cover-${index}`} className="bg-white border border-gray-200 flex flex-col justify-center items-center overflow-hidden">
          {/* Branding - centered */}
          <div className="text-center">
            <span className="font-playful font-bold text-[#1a1a1a]" style={{ fontSize: 'clamp(18px, 4vw, 32px)' }}>
              Storywin<span className="text-[#F76C5E]">k.ai</span>
            </span>
          </div>
          {/* Mascot: centered below text */}
          <Image
            src={BACK_COVER_MASCOT_URL}
            alt="Storywink mascot"
            width={150}
            height={150}
            className="mt-4 object-contain"
            style={{ height: '15%', width: 'auto' }}
          />
        </div>
      );
    }

    // Existing text/illustration rendering (dp is narrowed to text | illustration here)
    const pageKey = `${dp.page.id}-${dp.type}-${index}`;

    return (
      <div key={pageKey} className="bg-white border border-gray-200 flex justify-center items-center overflow-hidden">
        {dp.type === 'text' ? (
          // Text page - white background with centered story text
          <div className="w-full h-full flex items-center justify-center p-[10%]">
            <p className="font-playful text-[#1a1a1a] text-center leading-relaxed"
               style={{ fontSize: 'clamp(16px, 4vw, 28px)' }}>
              {dp.page.text}
            </p>
          </div>
        ) : dp.page.generatedImageUrl ? (
          // Illustration page - full image
          <div className="relative w-full h-full">
             <Image
               src={coolifyImageUrl(dp.page.generatedImageUrl)}
               alt={`Page ${dp.page.pageNumber} illustration`}
               fill
               sizes={`(max-width: 768px) 90vw, ${pageWidth}px`}
               style={{ objectFit: 'contain' }}
               priority={index <= 2}
             />
          </div>
        ) : (
          // Placeholder for loading or failed state
          <div className="text-center text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
            <p>Loading page {dp.page.pageNumber}...</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className={cn("w-full h-full flex items-center justify-center", className)}
    >
      {pageWidth > 0 && pageHeight > 0 && (
        <HTMLFlipBook
          ref={flipBookInternalRef}
          width={pageWidth}
          height={pageHeight}
          size="fixed"

          // Dummy "required" props to satisfy IProps
          className=""
          style={{}}
          startPage={0}
          minWidth={1}
          minHeight={1}
          maxWidth={4096}
          maxHeight={4096}
          startZIndex={0}
          autoSize={true}
          showCover={false}
          useMouseEvents={true}
          swipeDistance={30}
          showPageCorners={true}
          disableFlipByClick={false}

          // Real settings
          drawShadow
          maxShadowOpacity={0.7}
          flippingTime={700}
          usePortrait={isPortrait}
          mobileScrollSupport={false}
          clickEventForward

          // Event handlers
          onFlip={handleFlip}
          onInit={handleInit}
        >
          {displayPages.map((dp, index) => renderDisplayPage(dp, index))}
        </HTMLFlipBook>
      )}
    </div>
  );
});

FlipbookViewer.displayName = "FlipbookViewer";

export default FlipbookViewer;
