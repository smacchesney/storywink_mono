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
      {/* Coral cloud bubble around books with "Peek inside!" */}
      <div className="relative">
        {/* Cloud outline behind the books */}
        <motion.div
          className="absolute -inset-4 md:-inset-6 -top-10 md:-top-12 z-0 pointer-events-none"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          <svg
            className="w-full h-full"
            viewBox="0 0 500 340"
            fill="none"
            preserveAspectRatio="none"
          >
            <path
              d="M80 45 Q120 10 250 18 Q380 10 430 50 Q480 85 470 150 Q485 220 440 270 Q400 310 250 315 Q100 310 60 270 Q15 220 30 150 Q15 85 80 45Z"
              stroke="#F76C5E"
              strokeWidth="2.5"
              strokeDasharray="8 6"
              strokeLinecap="round"
              fill="none"
              opacity="0.5"
            />
          </svg>
        </motion.div>

        {/* "Peek inside!" label floating above cloud */}
        <motion.p
          className="relative z-10 text-center font-playful font-bold text-[#F76C5E] text-lg md:text-xl mb-1"
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transform: 'rotate(-3deg)' }}
        >
          Peek inside!
        </motion.p>

        <div className="relative z-10 flex items-end justify-center">
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
    </div>
  );
};

export default ExampleBookSelector;
