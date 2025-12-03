'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import HTMLFlipBook from 'react-pageflip';
import LandingFlipbookPage from './landing-flipbook-page';
import { cn } from '@/lib/utils';
import { optimizeCloudinaryUrl } from '@storywink/shared';

interface LandingFlipbookProps {
  pages: string[]; // Array of image URLs
  autoFlipInterval?: number; // ms between flips (default: 3500)
  idleResumeDelay?: number; // ms before resuming after interaction (default: 8000)
  coverPauseDuration?: number; // ms to pause on cover before reopening (default: 2000)
  flipBackSpeed?: number; // ms between flips when closing (default: 400)
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
  flipBackSpeed = 400,
  className,
}) => {
  const flipBookRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isBookOpen, setIsBookOpen] = useState(false); // Track if book is open (for centering)
  const [isClosing, setIsClosing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const autoFlipTimerRef = useRef<NodeJS.Timeout | null>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const closeIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
    if (closeIntervalRef.current) {
      clearInterval(closeIntervalRef.current);
      closeIntervalRef.current = null;
    }
  }, []);

  // Start closing animation (flip back to cover)
  const startClosingAnimation = useCallback(() => {
    setIsClosing(true);

    closeIntervalRef.current = setInterval(() => {
      const pageFlip = flipBookRef.current?.pageFlip();
      if (pageFlip) {
        const current = pageFlip.getCurrentPageIndex();
        if (current > 0) {
          pageFlip.flipPrev('top');
        } else {
          // Reached cover - stop closing and pause
          if (closeIntervalRef.current) {
            clearInterval(closeIntervalRef.current);
            closeIntervalRef.current = null;
          }
          setIsClosing(false);

          // Pause on cover, then restart auto-flip
          autoFlipTimerRef.current = setTimeout(() => {
            if (!isPaused) {
              const pf = flipBookRef.current?.pageFlip();
              if (pf) {
                pf.flipNext('bottom');
              }
            }
          }, coverPauseDuration);
        }
      }
    }, flipBackSpeed);
  }, [flipBackSpeed, coverPauseDuration, isPaused]);

  // Schedule next auto-flip
  const scheduleNextFlip = useCallback(() => {
    if (isPaused || isClosing) return;

    clearAllTimers();

    autoFlipTimerRef.current = setTimeout(() => {
      const pageFlip = flipBookRef.current?.pageFlip();
      if (pageFlip && !isPaused && !isClosing) {
        const current = pageFlip.getCurrentPageIndex();

        // Check if we're at the last page (or near it for spreads)
        if (current >= totalPages - 2) {
          // Start closing animation
          startClosingAnimation();
        } else {
          // Flip to next page
          pageFlip.flipNext('bottom');
        }
      }
    }, autoFlipInterval);
  }, [autoFlipInterval, isPaused, isClosing, totalPages, startClosingAnimation, clearAllTimers]);

  // Handle page flip event
  const handleFlip = useCallback((e: any) => {
    const pageIndex = e.data;

    // Track if book is open (page > 0) for centering
    setIsBookOpen(pageIndex > 0);

    // Schedule next flip if not closing
    if (!isClosing) {
      scheduleNextFlip();
    }
  }, [isClosing, scheduleNextFlip]);

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
    if (!isPaused && !isClosing && dimensions.width > 0) {
      scheduleNextFlip();
    }

    return () => clearAllTimers();
  }, [isPaused, isClosing, dimensions.width, scheduleNextFlip, clearAllTimers]);

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
        className="transition-transform duration-500 ease-in-out"
        style={{
          transform: isBookOpen ? 'translateX(0)' : 'translateX(-25%)',
        }}
      >
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

          // Interaction settings
          useMouseEvents={true}
          swipeDistance={30}
          showPageCorners={true}
          disableFlipByClick={false}
          usePortrait={false}
          mobileScrollSupport={false}
          clickEventForward={true}

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
