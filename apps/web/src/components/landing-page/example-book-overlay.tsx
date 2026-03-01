'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ExampleBook } from './example-books-data';
import { Page } from '@prisma/client';
import dynamic from 'next/dynamic';

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

const ExampleBookOverlay: React.FC<ExampleBookOverlayProps> = ({
  book,
  onClose,
  onCtaClick,
}) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

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

  // Body scroll lock
  useEffect(() => {
    if (!book) return undefined;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [book]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  return (
    <AnimatePresence>
      {book && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={handleBackdropClick}
            aria-hidden="true"
          />

          {/* Content */}
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-label={book.title}
          >
            <motion.div
              className="relative bg-[var(--bg-playful)] rounded-2xl w-[95vw] md:w-full max-w-2xl max-h-[90vh] overflow-y-auto p-3 md:p-6 shadow-2xl"
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button — 44px minimum touch target */}
              <button
                ref={closeButtonRef}
                onClick={onClose}
                className="absolute top-3 right-3 z-10 w-11 h-11 rounded-full bg-white shadow-md flex items-center justify-center text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-all cursor-pointer"
                aria-label="Close book preview"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Title */}
              <h2 className="text-lg md:text-xl font-playful font-bold text-[#1a1a1a] text-center mb-3 pr-12">
                {book.title}
              </h2>

              {/* FlipbookViewer — needs a container with explicit dimensions */}
              <div className="relative w-full" style={{ height: 'min(55vh, 420px)' }}>
                <FlipbookViewer
                  pages={book.bookPages as unknown as Page[]}
                  childName={book.childName}
                  bookTitle={book.title}
                  className="absolute inset-0"
                />
              </div>

              {/* CTA button — below flipbook, after user has browsed */}
              <div className="flex justify-center mt-4">
                <Button
                  size="lg"
                  variant="default"
                  className="w-full sm:w-auto px-6 py-2.5 md:px-8 md:py-3 text-base md:text-lg bg-[#F76C5E] text-white hover:bg-[#e55d4f] transition-all rounded-full font-playful group"
                  onClick={onCtaClick}
                >
                  <svg
                    className="mr-2 h-4 w-4 md:h-5 md:w-5 transition-transform group-hover:scale-125 group-hover:rotate-12"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 0L14.59 8.41L23 11L14.59 13.59L12 22L9.41 13.59L1 11L9.41 8.41L12 0Z" />
                  </svg>
                  Create Your Storybook
                </Button>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ExampleBookOverlay;
