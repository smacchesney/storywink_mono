'use client';

import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import HTMLFlipBook from 'react-pageflip';
import { Page } from '@prisma/client';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface FlipbookViewerProps {
  pages: Page[];
  initialPageNumber?: number;
  onPageChange?: (pageNumber: number) => void;
  className?: string;
  // width and height props are removed as dimensions are now derived
}

// Define the type for the imperative handle
export interface FlipbookActions {
  pageFlip: () => any; // Expose the pageFlip API instance
}

// Use forwardRef to allow passing ref from parent
const FlipbookViewer = forwardRef<FlipbookActions, FlipbookViewerProps>((
  {
    pages,
    initialPageNumber = 1,
    onPageChange,
    className,
    // width and height props removed from destructuring
  },
  ref // Receive the forwarded ref
) => {
  const flipBookInternalRef = useRef<any>(null);
  const [containerDimensions, setContainerDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null); // Ref for the container div

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
    // The event `e` usually contains the current page number (data)
    const currentPage = e.data; 
    console.log('Flipped to page:', currentPage);
    if (onPageChange) {
      onPageChange(currentPage + 1); // Library might be 0-indexed, adjust as needed
    }
  }, [onPageChange]);

  // Add onInit handler to turn to initial page once ready
  const handleInit = useCallback(() => {
     if (flipBookInternalRef.current && initialPageNumber) {
        // Ensure page number is within valid range (0 to pageCount - 1)
        const pageIndex = Math.max(0, Math.min(initialPageNumber - 1, pages.length - 1));
        console.log(`Flipbook initialized. Turning to initial page index: ${pageIndex}`);
            try {
               flipBookInternalRef.current?.pageFlip()?.turnToPage(pageIndex);
            } catch (e) {
               console.error("Error turning page on init:", e);
            }
     }
  }, [initialPageNumber, pages.length]);

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

          // Dummy "required" props to satisfy IProps (Option A)
          className=""
          style={{}}
          startPage={0}
          minWidth={1}
          minHeight={1}
          maxWidth={4096}
          maxHeight={4096}
          // Adding more dummy props based on linter feedback and original values
          startZIndex={0}          // Original: 0
          autoSize={true}          // Original: true
          showCover={false}        // Original: false
          useMouseEvents={true}    // Original: true
          // Adding the remaining missing props based on new linter feedback
          swipeDistance={30}       // Original: 30
          showPageCorners={true}   // Original: true
          disableFlipByClick={false} // Original: false

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
          {pages.map((page, index) => ( // index can be used if page.pageNumber is not reliable for priority
            <div key={page.id || index} className="bg-white border border-gray-200 flex justify-center items-center overflow-hidden">
              {/* Page content - Render Image or loading/error state */}
              {page.generatedImageUrl ? (
                <div className="relative w-full h-full">
                   <Image
                     src={page.generatedImageUrl}
                     alt={`Page ${page.pageNumber}`}
                     fill
                     sizes={`(max-width: 768px) 90vw, ${pageWidth}px`}
                     style={{ objectFit: 'contain' }}
                     priority={page.pageNumber <= 2} // Use page.pageNumber for priority
                   />
                </div>
              ) : (
                // Placeholder for loading or failed state
                <div className="text-center text-muted-foreground">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                  <p>Loading page {page.pageNumber}...</p>
                </div>
              )}
            </div>
          ))}
        </HTMLFlipBook>
      )}
    </div>
  );
});

FlipbookViewer.displayName = "FlipbookViewer"; // Add display name for DevTools

export default FlipbookViewer; 