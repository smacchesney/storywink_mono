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
    <div className="flex h-full w-full items-center justify-center">
      <div className="aspect-square w-full max-w-sm animate-pulse rounded-lg bg-[var(--cream-yellow)]" />
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
const ExampleBookOverlay: React.FC<ExampleBookOverlayProps> = ({ book, onClose, onCtaClick }) => {
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
    [book, layout],
  );
  const { totalViews, currentView, isAtEnd } = computeViewState(
    layout,
    displayCount,
    currentPage - 1,
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
    [onClose],
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
              className="relative flex h-full w-full max-w-none flex-col overflow-x-hidden overflow-y-auto rounded-none bg-[var(--bg-playful)] p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl md:h-auto md:max-h-[90vh] md:w-full md:max-w-4xl md:rounded-2xl md:p-6"
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
                className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-10 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-white text-ink-soft shadow-md transition-all hover:bg-coral-soft/60 hover:text-ink"
                aria-label={t('closePreview')}
              >
                <X className="h-5 w-5" />
              </button>

              {/* Title + Style */}
              <div className="mb-3 pr-12 text-center short:mb-1">
                <h2 className="font-playful text-xl font-bold text-ink md:text-2xl">
                  {book.title}
                </h2>
                <p className="mt-0.5 font-playful text-sm text-ink-soft md:text-base short:hidden">
                  {t('overlayStyle')}{' '}
                  <span className="text-coral">{t(`styleNames.${book.styleKey}`)}</span>
                </p>
              </div>

              {/* FlipbookViewer with navigation arrows — absorbs remaining height on mobile */}
              <div className="relative min-h-[280px] w-full flex-1 overflow-hidden md:h-[60vh] md:max-h-[520px] md:flex-none short:min-h-[200px]">
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
                  className="absolute top-1/2 left-1 z-10 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/80 text-coral shadow-md transition-all hover:bg-white hover:text-coral-hover disabled:pointer-events-none disabled:opacity-0 md:left-3 md:h-10 md:w-10"
                  aria-label={t('prevPage')}
                >
                  <ChevronLeft className="h-5 w-5 md:h-6 md:w-6" />
                </button>

                {/* Next page arrow */}
                <button
                  onClick={handleNext}
                  disabled={isAtEnd}
                  className="absolute top-1/2 right-1 z-10 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/80 text-coral shadow-md transition-all hover:bg-white hover:text-coral-hover disabled:pointer-events-none disabled:opacity-0 md:right-3 md:h-10 md:w-10"
                  aria-label={t('nextPage')}
                >
                  <ChevronRight className="h-5 w-5 md:h-6 md:w-6" />
                </button>
              </div>

              {/* Read Again button — always rendered, opacity-controlled to prevent layout shift */}
              <div className="mt-3 flex justify-center short:mt-1">
                <button
                  onClick={handleRestart}
                  className={`flex cursor-pointer items-center gap-2 rounded-full border border-coral/40 px-4 py-1.5 font-playful text-sm text-coral transition-all duration-300 hover:bg-coral/5 hover:text-coral-hover ${isAtEnd ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
                  tabIndex={isAtEnd ? 0 : -1}
                >
                  <RotateCcw className="h-4 w-4" />
                  {t('readAgain')}
                </button>
              </div>

              {/* Progress dots — view-based, capped so long books stay calm */}
              <div className="mt-2 flex items-center justify-center gap-0.5 py-1">
                {Array.from({ length: dotCount }).map((_, idx) => {
                  const isFilled = idx <= activeDot;
                  const isCurrent = idx === activeDot;
                  return (
                    <div
                      key={idx}
                      className={`h-1.5 rounded-full transition-all duration-300 ${isCurrent ? 'w-4' : 'w-1.5'} ${isFilled ? 'bg-coral' : 'bg-gray-300'} `}
                    />
                  );
                })}
              </div>

              {/* CTA button — THE string, same as every landing instance */}
              <div className="mt-4 flex justify-center short:mt-2">
                <Button
                  size="lg"
                  variant="default"
                  className="group w-full rounded-full bg-coral px-6 py-2.5 font-playful text-base text-white transition-all hover:bg-coral-hover sm:w-auto md:px-8 md:py-3 md:text-lg"
                  onClick={onCtaClick}
                >
                  <SparkleIcon className="mr-2 h-4 w-4 transition-transform group-hover:scale-125 group-hover:rotate-12 md:h-5 md:w-5" />
                  {t('createYourStorybook')}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default ExampleBookOverlay;
