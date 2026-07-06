'use client';

import React, { useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { ExampleBook, getCoverUrl, getAllImageUrls } from './example-books-data';

interface ExampleBookSelectorProps {
  books: ExampleBook[];
  onSelectBook: (book: ExampleBook) => void;
  className?: string;
}

const fanConfigs = [
  { rotate: -8, translateX: 24, zIndex: 1 },
  { rotate: 0, translateX: 0, zIndex: 3 },
  { rotate: 8, translateX: -24, zIndex: 1 },
];

// Gentle ±3° tilts for the flat mobile row.
const mobileTilts = ['-rotate-3', 'rotate-0', 'rotate-3'];

const ExampleBookSelector: React.FC<ExampleBookSelectorProps> = ({
  books,
  onSelectBook,
  className,
}) => {
  const t = useTranslations('landing');
  const prefersReduced = useReducedMotion();

  // Preload cover images immediately, then all page images after a short delay
  useEffect(() => {
    books.forEach((book) => {
      const img = new window.Image();
      img.src = getCoverUrl(book);
    });

    // Preload all page images so flipbook opens instantly
    const timer = setTimeout(() => {
      books.forEach((book) => {
        getAllImageUrls(book).forEach((url) => {
          const img = new window.Image();
          img.src = url;
        });
      });
    }, 1000);

    return () => clearTimeout(timer);
  }, [books]);

  // Style + page count read from the data at build — never hardcoded.
  const chip = (book: ExampleBook) => (
    <span className="inline-flex max-w-full items-center justify-center whitespace-normal rounded-full border-2 border-coral/30 bg-white px-2.5 py-0.5 text-center font-playful text-[11px] leading-snug text-ink shadow-sm md:text-xs">
      {t('chipLabel', {
        style: t(`styleNames.${book.styleKey}`),
        count: book.bookPages.length,
      })}
    </span>
  );

  const tapToRead = (
    <motion.p
      className="relative z-10 mt-3 text-center font-playful text-lg font-bold text-coral md:text-xl"
      animate={prefersReduced ? undefined : { y: [0, 3, 0] }}
      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
      style={{ transform: 'rotate(-2deg)' }}
    >
      {t('tapToRead')}
    </motion.p>
  );

  return (
    <div className={cn('flex flex-col items-center', className)}>
      {/* Mobile (<md): flat row of three fully tappable covers, no overlap */}
      <div className="w-full md:hidden">
        <div className="flex items-start justify-center gap-3 px-2">
          {books.map((book, index) => (
            <button
              key={book.id}
              onClick={() => onSelectBook(book)}
              aria-label={t('readBookAria', { title: book.title })}
              className={cn(
                'flex w-[30vw] max-w-[140px] cursor-pointer flex-col items-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--coral-primary)] focus-visible:ring-offset-2',
                mobileTilts[index] || 'rotate-0'
              )}
            >
              <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-[var(--cream-yellow)] shadow-lg">
                <Image
                  src={getCoverUrl(book)}
                  alt={book.coverAlt}
                  fill
                  sizes="30vw"
                  className="object-cover"
                />
              </div>
              {chip(book)}
            </button>
          ))}
        </div>
        {tapToRead}
      </div>

      {/* md+: overlapping fan with accent rays */}
      <div className="relative hidden overflow-visible md:block">
        {/* Accent lines radiating from book stack */}
        <motion.div
          className="absolute z-0 pointer-events-none overflow-visible"
          style={{ inset: -40 }}
          initial={prefersReduced ? false : { opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          {/* Top-left cluster */}
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 32, top: -8, left: '22%', transform: 'rotate(-22deg)', background: 'var(--coral-primary)', opacity: 0.6 }} />
          <span className="absolute block rounded-full" style={{ width: 3, height: 26, top: -12, left: '36%', transform: 'rotate(-8deg)', background: 'var(--coral-primary)', opacity: 0.5 }} />
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 30, top: 2, left: 10, transform: 'rotate(-52deg)', background: 'var(--coral-primary)', opacity: 0.55 }} />

          {/* Top-center accent */}
          <span className="absolute block rounded-full" style={{ width: 3, height: 28, top: -14, left: '50%', transform: 'translateX(-50%) rotate(2deg)', background: 'var(--coral-primary)', opacity: 0.5 }} />

          {/* Top-right cluster */}
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 32, top: -8, right: '22%', transform: 'rotate(22deg)', background: 'var(--coral-primary)', opacity: 0.6 }} />
          <span className="absolute block rounded-full" style={{ width: 3, height: 26, top: -12, right: '36%', transform: 'rotate(8deg)', background: 'var(--coral-primary)', opacity: 0.5 }} />
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 30, top: 2, right: 10, transform: 'rotate(52deg)', background: 'var(--coral-primary)', opacity: 0.55 }} />

          {/* Left side */}
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 28, top: '36%', left: 4, transform: 'rotate(-82deg)', background: 'var(--coral-primary)', opacity: 0.55 }} />
          <span className="absolute block rounded-full" style={{ width: 3, height: 24, top: '56%', left: 6, transform: 'rotate(-72deg)', background: 'var(--coral-primary)', opacity: 0.45 }} />

          {/* Right side */}
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 28, top: '36%', right: 4, transform: 'rotate(82deg)', background: 'var(--coral-primary)', opacity: 0.55 }} />
          <span className="absolute block rounded-full" style={{ width: 3, height: 24, top: '56%', right: 6, transform: 'rotate(72deg)', background: 'var(--coral-primary)', opacity: 0.45 }} />

          {/* Bottom-left cluster */}
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 30, bottom: 4, left: '22%', transform: 'rotate(24deg)', background: 'var(--coral-primary)', opacity: 0.55 }} />
          <span className="absolute block rounded-full" style={{ width: 3, height: 26, bottom: 8, left: '10%', transform: 'rotate(48deg)', background: 'var(--coral-primary)', opacity: 0.5 }} />

          {/* Bottom-right cluster */}
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 30, bottom: 4, right: '22%', transform: 'rotate(-24deg)', background: 'var(--coral-primary)', opacity: 0.55 }} />
          <span className="absolute block rounded-full" style={{ width: 3, height: 26, bottom: 8, right: '10%', transform: 'rotate(-48deg)', background: 'var(--coral-primary)', opacity: 0.5 }} />
        </motion.div>

        <div className="relative z-10 flex items-start justify-center">
          {books.map((book, index) => {
            const config = fanConfigs[index] || fanConfigs[1];

            return (
              <motion.button
                key={book.id}
                onClick={() => onSelectBook(book)}
                className="relative flex cursor-pointer flex-col items-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--coral-primary)] focus-visible:ring-offset-2"
                style={{ zIndex: config.zIndex }}
                initial={
                  prefersReduced
                    ? false
                    : { rotate: config.rotate, x: config.translateX, opacity: 0, y: 20 }
                }
                animate={{
                  rotate: config.rotate,
                  x: config.translateX,
                  opacity: 1,
                  y: 0,
                }}
                whileHover={
                  prefersReduced
                    ? undefined
                    : {
                        scale: 1.1,
                        y: -14,
                        rotate: 0,
                        zIndex: 10,
                        transition: { type: 'spring', stiffness: 300, damping: 20 },
                      }
                }
                whileTap={{ scale: 0.97 }}
                transition={{
                  type: 'spring',
                  stiffness: 200,
                  damping: 20,
                  delay: prefersReduced ? 0 : index * 0.08,
                }}
                aria-label={t('readBookAria', { title: book.title })}
              >
                <div
                  className="relative rounded-xl overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 bg-[var(--cream-yellow)] border-2 border-transparent hover:border-[var(--coral-primary)]/30"
                  style={{ width: 180, height: 180 }}
                >
                  <Image
                    src={getCoverUrl(book)}
                    alt={book.coverAlt}
                    fill
                    sizes="180px"
                    className="object-cover"
                  />
                </div>
                {chip(book)}
              </motion.button>
            );
          })}
        </div>

        {tapToRead}
      </div>
    </div>
  );
};

export default ExampleBookSelector;
