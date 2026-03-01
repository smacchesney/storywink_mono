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
      {/* Book stack with accent lines and "Peek inside!" below */}
      <div className="relative overflow-visible">
        {/* Accent lines radiating from book stack */}
        <motion.div
          className="absolute z-0 pointer-events-none overflow-visible"
          style={{ inset: -40 }}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          {/* Top-left cluster */}
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 32, top: 2, left: '20%', transform: 'rotate(-22deg)', background: '#F76C5E', opacity: 0.6 }} />
          <span className="absolute block rounded-full" style={{ width: 3, height: 26, top: -4, left: '34%', transform: 'rotate(-8deg)', background: '#F76C5E', opacity: 0.5 }} />
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 30, top: 22, left: 2, transform: 'rotate(-52deg)', background: '#F76C5E', opacity: 0.55 }} />

          {/* Top-right cluster */}
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 32, top: 2, right: '20%', transform: 'rotate(22deg)', background: '#F76C5E', opacity: 0.6 }} />
          <span className="absolute block rounded-full" style={{ width: 3, height: 26, top: -4, right: '34%', transform: 'rotate(8deg)', background: '#F76C5E', opacity: 0.5 }} />
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 30, top: 22, right: 2, transform: 'rotate(52deg)', background: '#F76C5E', opacity: 0.55 }} />

          {/* Left side */}
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 28, top: '36%', left: 0, transform: 'rotate(-82deg)', background: '#F76C5E', opacity: 0.55 }} />
          <span className="absolute block rounded-full" style={{ width: 3, height: 24, top: '56%', left: 2, transform: 'rotate(-72deg)', background: '#F76C5E', opacity: 0.45 }} />

          {/* Right side */}
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 28, top: '36%', right: 0, transform: 'rotate(82deg)', background: '#F76C5E', opacity: 0.55 }} />
          <span className="absolute block rounded-full" style={{ width: 3, height: 24, top: '56%', right: 2, transform: 'rotate(72deg)', background: '#F76C5E', opacity: 0.45 }} />

          {/* Bottom-left cluster */}
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 30, bottom: 10, left: '18%', transform: 'rotate(24deg)', background: '#F76C5E', opacity: 0.55 }} />
          <span className="absolute block rounded-full" style={{ width: 3, height: 26, bottom: 16, left: '4%', transform: 'rotate(48deg)', background: '#F76C5E', opacity: 0.5 }} />

          {/* Bottom-right cluster */}
          <span className="absolute block rounded-full" style={{ width: 3.5, height: 30, bottom: 10, right: '18%', transform: 'rotate(-24deg)', background: '#F76C5E', opacity: 0.55 }} />
          <span className="absolute block rounded-full" style={{ width: 3, height: 26, bottom: 16, right: '4%', transform: 'rotate(-48deg)', background: '#F76C5E', opacity: 0.5 }} />
        </motion.div>

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

        {/* "Peek inside!" below the book stack */}
        <motion.p
          className="relative z-10 text-center font-playful font-bold text-[#F76C5E] text-lg md:text-xl mt-3"
          animate={{ y: [0, 3, 0] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transform: 'rotate(-2deg)' }}
        >
          Peek inside!
        </motion.p>
      </div>
    </div>
  );
};

export default ExampleBookSelector;
