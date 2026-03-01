'use client';

import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { ExampleBook, getCoverUrl } from './example-books-data';

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

const ExampleBookSelector: React.FC<ExampleBookSelectorProps> = ({
  books,
  onSelectBook,
  className,
}) => {
  // Preload cover images
  useEffect(() => {
    books.forEach((book) => {
      const img = new window.Image();
      img.src = getCoverUrl(book);
    });
  }, [books]);

  return (
    <div className={cn('flex flex-col items-center', className)}>
      {/* Playful bouncing prompt */}
      {/* Playful prompt with hand-drawn curved arrow */}
      <motion.div
        className="flex flex-col items-center mb-1"
        animate={{ y: [0, 5, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span className="text-lg md:text-xl font-playful font-bold text-[#F76C5E]">
          Peek inside!
        </span>
        {/* Hand-drawn curved arrow pointing down */}
        <svg
          className="w-10 h-10 md:w-12 md:h-12 text-[#F76C5E] mt-0.5"
          viewBox="0 0 60 60"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M30 6C28 14 24 20 22 28C20 34 21 40 26 46"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ filter: 'url(#hand-drawn)' }}
          />
          <path
            d="M18 40L26 47L33 41"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <defs>
            <filter id="hand-drawn">
              <feTurbulence type="turbulence" baseFrequency="0.05" numOctaves="2" result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.5" />
            </filter>
          </defs>
        </svg>
      </motion.div>

      <div className="flex items-end justify-center">
        {books.map((book, index) => {
          const config = fanConfigs[index] || fanConfigs[1];

          return (
            <motion.button
              key={book.id}
              onClick={() => onSelectBook(book)}
              className="relative cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--coral-primary)] focus-visible:ring-offset-2 rounded-xl"
              style={{ zIndex: config.zIndex }}
              initial={{
                rotate: config.rotate,
                x: config.translateX,
                opacity: 0,
                y: 20,
              }}
              animate={{
                rotate: config.rotate,
                x: config.translateX,
                opacity: 1,
                y: 0,
              }}
              whileHover={{
                scale: 1.1,
                y: -14,
                rotate: 0,
                zIndex: 10,
                transition: { type: 'spring', stiffness: 300, damping: 20 },
              }}
              whileTap={{ scale: 0.97 }}
              transition={{
                type: 'spring',
                stiffness: 200,
                damping: 20,
                delay: index * 0.08,
              }}
              aria-label={`Read ${book.title}`}
            >
              {/* Desktop cover */}
              <div
                className="hidden md:block relative rounded-xl overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 bg-[var(--cream-yellow)] border-2 border-transparent hover:border-[var(--coral-primary)]/30"
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

              {/* Mobile cover — larger to fill screen */}
              <div
                className="md:hidden relative rounded-lg overflow-hidden shadow-lg bg-[var(--cream-yellow)]"
                style={{ width: 140, height: 140 }}
              >
                <Image
                  src={getCoverUrl(book)}
                  alt={book.coverAlt}
                  fill
                  sizes="140px"
                  className="object-cover"
                />
              </div>

              {/* Title below cover - desktop only */}
              <p className="hidden md:block text-xs font-playful text-slate-500 mt-2 max-w-[180px] line-clamp-2 text-center leading-tight">
                {book.title}
              </p>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};

export default ExampleBookSelector;
