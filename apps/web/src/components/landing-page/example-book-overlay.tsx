'use client';

import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ExampleBook } from './example-books-data';
import { computeViewState, computeDots } from './overlay-view-math';
import { Page } from '@prisma/client';
import dynamic from 'next/dynamic';
import type { FlipbookActions } from '@/components/book/FlipbookViewer';
// Pure layout math — imported from display-pages directly so the heavy
// flipbook bundle stays inside the dynamic import below.
import { buildDisplayPages, type BookLayout } from '@/components/book/display-pages';
import { SparkleIcon } from './landing-cta';

const FlipbookViewer = dynamic(() => import('@/components/book/FlipbookViewer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <div
        className="w-full max-w-sm aspect-square bg-[var(--cream-yellow)] rounded-lg animate-pulse"
      />
    </div>
  ),
});

interface ExampleBookOverlayProps {
  book: ExampleBook | null;
  onClose: () => void;
  onCtaClick: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Full-screen example-book reader. Portaled to document.body so it escapes
 * the landing page's stacking contexts and paints over the site header. On
 * mobile it is a full-bleed sheet (the sheet IS the page, --bg-playful edge
 * to edge); on md+ a centered card. Progress tracks flipbook VIEWS via
 * overlay-view-math so portrait and spread layouts agree.
 */
const ExampleBookOverlay: React.FC<ExampleBookOverlayProps> = ({
  book,
  onClose,
  onCtaClick,
}) => {
  const t = useTranslations('landing');
  const prefersReduced = useReducedMotion();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const flipbookRef = useRef<FlipbookActions>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [layout, setLayout] = useState<BookLayout>('portrait');

  // View math: both layouts collapse to the same view count, so rotation
  // mid-read keeps progress honest. onPageChange reports displayIndex + 1.
  const displayCount = useMemo(
    () =>
      book
        ? buildDisplayPages(book.bookPages as unknown as Page[], {
            childName: book.childName,
            bookTitle: book.title,
            layout,
          }).length
        : 0,
    [book, layout]
  );
  const { totalViews, currentView, isAtEnd } = computeViewState(
    layout,
    displayCount,
    currentPage - 1
  );
  const { dotCount, activeDot } = computeDots(totalViews, currentView);

  // Reset page on book change
  useEffect(() => {
    if (book) setCurrentPage(1);
  }, [book]);

  // Escape key handler
  useEffect(() => {
    if (!book) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [book, onClose]);

  // Focus management
  useEffect(() => {
    if (book) {
      previousFocusRef.current = document.activeElement;
      const timer = setTimeout(() => closeButtonRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
    if (previousFocusRef.current instanceof HTMLElement) {
      previousFocusRef.current.focus();
    }
    return undefined;
  }, [book]);

  // Body scroll lock — the position:fixed pattern is the only one iOS Safari
  // respects. Preserve any inline body styles (the root layout sets one) and
  // restore the scroll position on close.
  useEffect(() => {
    if (!book) return undefined;
    const scrollY = window.scrollY;
    const previousCssText = document.body.style.cssText;
    document.body.style.cssText = `${previousCssText};position:fixed;top:-${scrollY}px;left:0;right:0;overflow:hidden`;
    return () => {
      document.body.style.cssText = previousCssText;
      window.scrollTo(0, scrollY);
    };
  }, [book]);

  // Keep keyboard focus inside the dialog: portaling to the end of <body>
  // would otherwise let Tab walk out into the page behind the backdrop.
  const handleTrapKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !cardRef.current) return;
    const focusables = cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && cardRef.current.contains(active);
    if (e.shiftKey) {
      if (!inside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  const handlePrev = useCallback(() => {
    flipbookRef.current?.pageFlip()?.flipPrev();
  }, []);

  const handleNext = useCallback(() => {
    flipbookRef.current?.pageFlip()?.flipNext();
  }, []);

  const handleRestart = useCallback(() => {
    flipbookRef.current?.pageFlip()?.turnToPage(0);
    setCurrentPage(1);
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {book && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            initial={prefersReduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReduced ? 0 : 0.3 }}
            onClick={handleBackdropClick}
            aria-hidden="true"
          />

          {/* Content */}
          <motion.div
            className="fixed inset-0 z-[70] flex items-center justify-center p-0 md:p-6"
            initial={prefersReduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={prefersReduced ? { duration: 0 } : undefined}
            onClick={handleBackdropClick}
            onKeyDown={handleTrapKeyDown}
            role="dialog"
            aria-modal="true"
            aria-label={book.title}
          >
            <motion.div
              ref={cardRef}
              className="relative flex h-full w-full max-w-none flex-col overflow-y-auto overflow-x-hidden rounded-none bg-[var(--bg-playful)] p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl md:h-auto md:max-h-[90vh] md:w-full md:max-w-4xl md:rounded-2xl md:p-6"
              initial={prefersReduced ? false : { scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={prefersReduced ? { opacity: 0 } : { scale: 0.9, y: 20 }}
              transition={{ duration: prefersReduced ? 0 : 0.35, ease: [0.4, 0, 0.2, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button — 44px minimum touch target, clear of the notch */}
              <button
                ref={closeButtonRef}
                onClick={onClose}
                className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-10 w-11 h-11 rounded-full bg-white shadow-md flex items-center justify-center text-ink-soft hover:text-ink hover:bg-coral-soft/60 transition-all cursor-pointer"
                aria-label={t('closePreview')}
              >
                <X className="w-5 h-5" />
              </button>

              {/* Title + Style */}
              <div className="text-center mb-3 pr-12 short:mb-1">
                <h2 className="text-xl md:text-2xl font-playful font-bold text-ink">
                  {book.title}
                </h2>
                <p className="font-playful text-sm md:text-base mt-0.5 text-ink-soft short:hidden">
                  {t('overlayStyle')}{' '}
                  <span className="text-coral">{t(`styleNames.${book.styleKey}`)}</span>
                </p>
              </div>

              {/* FlipbookViewer with navigation arrows — absorbs remaining height on mobile */}
              <div className="relative w-full overflow-hidden flex-1 min-h-[280px] short:min-h-[200px] md:flex-none md:h-[60vh] md:max-h-[520px]">
                <FlipbookViewer
                  ref={flipbookRef}
                  pages={book.bookPages as unknown as Page[]}
                  childName={book.childName}
                  bookTitle={book.title}
                  onPageChange={setCurrentPage}
                  onLayoutChange={setLayout}
                  className="absolute inset-0"
                />

                {/* Previous page arrow */}
                <button
                  onClick={handlePrev}
                  disabled={currentView <= 0}
                  className="absolute left-1 md:left-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/80 hover:bg-white shadow-md flex items-center justify-center text-coral hover:text-coral-hover transition-all disabled:opacity-0 disabled:pointer-events-none cursor-pointer"
                  aria-label={t('prevPage')}
                >
                  <ChevronLeft className="w-5 h-5 md:w-6 md:h-6" />
                </button>

                {/* Next page arrow */}
                <button
                  onClick={handleNext}
                  disabled={isAtEnd}
                  className="absolute right-1 md:right-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 md:w-10 md:h-10 rounded-full bg-white/80 hover:bg-white shadow-md flex items-center justify-center text-coral hover:text-coral-hover transition-all disabled:opacity-0 disabled:pointer-events-none cursor-pointer"
                  aria-label={t('nextPage')}
                >
                  <ChevronRight className="w-5 h-5 md:w-6 md:h-6" />
                </button>
              </div>

              {/* Read Again button — always rendered, opacity-controlled to prevent layout shift */}
              <div className="flex justify-center mt-3 short:mt-1">
                <button
                  onClick={handleRestart}
                  className={`flex items-center gap-2 px-4 py-1.5 text-sm font-playful text-coral hover:text-coral-hover hover:bg-coral/5 border border-coral/40 rounded-full transition-all duration-300 cursor-pointer ${isAtEnd ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                  tabIndex={isAtEnd ? 0 : -1}
                >
                  <RotateCcw className="w-4 h-4" />
                  {t('readAgain')}
                </button>
              </div>

              {/* Progress dots — view-based, capped so long books stay calm */}
              <div className="flex gap-0.5 items-center justify-center mt-2 py-1">
                {Array.from({ length: dotCount }).map((_, idx) => {
                  const isFilled = idx <= activeDot;
                  const isCurrent = idx === activeDot;
                  return (
                    <div
                      key={idx}
                      className={`
                        h-1.5 rounded-full transition-all duration-300
                        ${isCurrent ? 'w-4' : 'w-1.5'}
                        ${isFilled ? 'bg-coral' : 'bg-gray-300'}
                      `}
                    />
                  );
                })}
              </div>

              {/* CTA button — THE string, same as every landing instance */}
              <div className="flex justify-center mt-4 short:mt-2">
                <Button
                  size="lg"
                  variant="default"
                  className="w-full sm:w-auto px-6 py-2.5 md:px-8 md:py-3 text-base md:text-lg bg-coral text-white hover:bg-coral-hover transition-all rounded-full font-playful group"
                  onClick={onCtaClick}
                >
                  <SparkleIcon className="mr-2 h-4 w-4 md:h-5 md:w-5 transition-transform group-hover:scale-125 group-hover:rotate-12" />
                  {t('createYourStorybook')}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default ExampleBookOverlay;
