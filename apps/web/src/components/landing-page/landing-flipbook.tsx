'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import HTMLFlipBook from 'react-pageflip';
import LandingFlipbookPage from './landing-flipbook-page';
import { cn } from '@/lib/utils';
import { optimizeCloudinaryUrl } from '@storywink/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface LandingFlipbookProps {
  pages: string[]; // Array of image URLs
  autoFlipInterval?: number; // ms between flips (default: 3500)
  idleResumeDelay?: number; // ms before resuming after interaction (default: 8000)
  coverPauseDuration?: number; // ms to pause on cover before reopening (default: 2000)
  className?: string;
}

/**
 * Landing page flipbook component showing a sample storybook.
 * Starts closed (showing cover), auto-opens and flips through pages,
 * then closes back to cover and loops.
 */
const LandingFlipbook: React.FC<LandingFlipbookProps> = ({
  pages,
  autoFlipInterval = 3500,
  idleResumeDelay = 8000,
  coverPauseDuration = 2000,
  className,
}) => {
  const flipBookRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isBookOpen, setIsBookOpen] = useState(false); // Track if book is open (for centering)
  const [isPaused, setIsPaused] = useState(false);
  const [isMobile, setIsMobile] = useState(false); // Track mobile viewport for touch behavior
  const [currentPage, setCurrentPage] = useState(0); // Track current page for arrow visibility

  const autoFlipTimerRef = useRef<NodeJS.Timeout | null>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const totalPages = pages.length;

  // Calculate dimensions based on container
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        const maxWidth = Math.min(containerWidth, 448); // 28rem max

        // Book pages are square (2048x2048)
        const pageWidth = maxWidth / 2; // Each page is half the spread
        const pageHeight = pageWidth; // Square pages (1:1 aspect ratio)

        setDimensions({
          width: Math.floor(pageWidth),
          height: Math.floor(pageHeight),
        });
      }
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Clear all timers
  const clearAllTimers = useCallback(() => {
    if (autoFlipTimerRef.current) {
      clearTimeout(autoFlipTimerRef.current);
      autoFlipTimerRef.current = null;
    }
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  // Schedule next auto-flip
  const scheduleNextFlip = useCallback(() => {
    if (isPaused) return;

    clearAllTimers();

    autoFlipTimerRef.current = setTimeout(() => {
      const pageFlip = flipBookRef.current?.pageFlip();
      if (pageFlip && !isPaused) {
        const current = pageFlip.getCurrentPageIndex();

        // Check if we're at the last page (or near it for spreads)
        if (current >= totalPages - 2) {
          // Flip directly back to cover (with animation)
          pageFlip.flip(0, 'top');
        } else {
          // Flip to next page
          pageFlip.flipNext('bottom');
        }
      }
    }, autoFlipInterval);
  }, [autoFlipInterval, isPaused, totalPages, clearAllTimers]);

  // Handle page flip event
  const handleFlip = useCallback((e: any) => {
    const pageIndex = e.data;

    // Track current page for arrow visibility
    setCurrentPage(pageIndex);

    // Track if book is open (page > 0) for centering
    setIsBookOpen(pageIndex > 0);

    // Schedule next flip
    scheduleNextFlip();
  }, [scheduleNextFlip]);

  // Handle user interaction - pause auto-flip
  const handleUserInteraction = useCallback(() => {
    setIsPaused(true);
    clearAllTimers();

    // Resume after idle delay
    idleTimerRef.current = setTimeout(() => {
      setIsPaused(false);
    }, idleResumeDelay);
  }, [idleResumeDelay, clearAllTimers]);

  // Detect user interaction via state changes
  const handleStateChange = useCallback((e: any) => {
    const state = e.data;
    // 'user_fold' or 'flipping' triggered by user
    if (state === 'user_fold') {
      handleUserInteraction();
    }
  }, [handleUserInteraction]);

  // Start auto-flip when not paused
  useEffect(() => {
    if (!isPaused && dimensions.width > 0) {
      scheduleNextFlip();
    }

    return () => clearAllTimers();
  }, [isPaused, dimensions.width, scheduleNextFlip, clearAllTimers]);

  // Initial flip to open the book after mount
  useEffect(() => {
    if (dimensions.width <= 0) {
      return;
    }

    const initialTimer = setTimeout(() => {
      const pageFlip = flipBookRef.current?.pageFlip();
      if (pageFlip && !isPaused) {
        pageFlip.flipNext('bottom');
      }
    }, coverPauseDuration);

    return () => clearTimeout(initialTimer);
  }, [dimensions.width, coverPauseDuration, isPaused]);

  // Preload all images
  useEffect(() => {
    pages.forEach((url) => {
      const img = new window.Image();
      img.src = optimizeCloudinaryUrl(url);
    });
  }, [pages]);

  // Mobile arrow navigation handlers
  const handlePrevPage = useCallback(() => {
    const pageFlip = flipBookRef.current?.pageFlip();
    if (pageFlip && currentPage > 0) {
      pageFlip.flipPrev('top');
      handleUserInteraction(); // Pause auto-flip when user navigates
    }
  }, [currentPage, handleUserInteraction]);

  const handleNextPage = useCallback(() => {
    const pageFlip = flipBookRef.current?.pageFlip();
    if (pageFlip) {
      if (currentPage >= totalPages - 2) {
        // On last page - loop back to cover
        pageFlip.flip(0, 'top');
      } else {
        pageFlip.flipNext('bottom');
      }
      handleUserInteraction(); // Pause auto-flip when user navigates
    }
  }, [currentPage, totalPages, handleUserInteraction]);

  if (dimensions.width === 0) {
    // Loading placeholder - square aspect ratio
    return (
      <div
        ref={containerRef}
        className={cn("w-full max-w-md mx-auto", className)}
      >
        <div
          className="w-full bg-[var(--cream-yellow)] rounded-lg animate-pulse"
          style={{ aspectRatio: '1' }}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn("w-full max-w-md mx-auto flex justify-center overflow-hidden", className)}
    >
      {/* Wrapper for centering: shifts left when closed (cover only), centered when open (spread) */}
      <div
        className="relative transition-transform duration-500 ease-in-out"
        style={{
          transform: isBookOpen ? 'translateX(0)' : 'translateX(-25%)',
        }}
      >
        {/* Navigation arrows */}
        <>
          {/* Left arrow - hidden on cover (page 0) */}
          {currentPage > 0 && (
            <button
              onClick={handlePrevPage}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10
                w-10 h-10 rounded-full bg-white/80 backdrop-blur-sm
                flex items-center justify-center
                text-[var(--coral-primary)] hover:bg-white hover:scale-110 active:scale-95
                transition-all duration-200 shadow-md cursor-pointer"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}
          {/* Right arrow - always visible (loops back to cover on last page) */}
          <button
            onClick={handleNextPage}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-10
              w-10 h-10 rounded-full bg-white/80 backdrop-blur-sm
              flex items-center justify-center
              text-[var(--coral-primary)] hover:bg-white hover:scale-110 active:scale-95
              transition-all duration-200 shadow-md cursor-pointer"
            aria-label="Next page"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>

        <HTMLFlipBook
          ref={flipBookRef}
          width={dimensions.width}
          height={dimensions.height}
          size="fixed"

          // Required props
          className=""
          style={{}}
          startPage={0}
          minWidth={100}
          minHeight={100}
          maxWidth={1000}
          maxHeight={1000}
          startZIndex={0}
          autoSize={false}

          // Cover settings - IMPORTANT: enables closed book start
          showCover={true}

          // Interaction settings - conditional based on mobile
          useMouseEvents={!isMobile}
          swipeDistance={isMobile ? 0 : 30}
          showPageCorners={!isMobile}
          disableFlipByClick={isMobile}
          usePortrait={false}
          mobileScrollSupport={isMobile}
          clickEventForward={!isMobile}

          // Visual settings
          drawShadow={true}
          maxShadowOpacity={0.5}
          flippingTime={700}

          // Event handlers
          onFlip={handleFlip}
          onChangeState={handleStateChange}
        >
          {pages.map((url, index) => (
            <LandingFlipbookPage
              key={index}
              imageUrl={optimizeCloudinaryUrl(url)}
              alt={`Storybook page ${index + 1}`}
              pageNumber={index + 1}
              priority={index < 4}
            />
          ))}
        </HTMLFlipBook>
      </div>
    </div>
  );
};

export default LandingFlipbook;
