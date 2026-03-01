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
      <p className="text-sm md:text-base font-playful text-slate-600 mb-4">
        Click a book to read it
      </p>

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

              {/* Mobile cover */}
              <div
                className="md:hidden relative rounded-lg overflow-hidden shadow-lg bg-[var(--cream-yellow)]"
                style={{ width: 120, height: 120 }}
              >
                <Image
                  src={getCoverUrl(book)}
                  alt={book.coverAlt}
                  fill
                  sizes="120px"
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

      <p className="text-xs text-slate-500 mt-4 md:hidden font-playful">
        Tap a book to read it
      </p>
    </div>
  );
};

export default ExampleBookSelector;
