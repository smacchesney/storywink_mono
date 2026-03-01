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
      <motion.div
        className="flex items-center gap-1.5 mb-3"
        animate={{ y: [0, 5, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span className="text-sm md:text-base font-playful font-bold text-[#F76C5E]">
          Peek inside
        </span>
        <svg
          className="w-5 h-5 md:w-6 md:h-6 text-[#F76C5E]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 10l5 5 5-5" />
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
