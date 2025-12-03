'use client';

import React, { forwardRef } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface LandingFlipbookPageProps {
  imageUrl: string;
  alt: string;
  pageNumber: number;
  priority?: boolean;
}

/**
 * Individual page component for the landing page flipbook.
 * Must use forwardRef as required by react-pageflip's HTMLFlipBook.
 */
const LandingFlipbookPage = forwardRef<HTMLDivElement, LandingFlipbookPageProps>(
  ({ imageUrl, alt, pageNumber: _pageNumber, priority = false }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "w-full h-full bg-[var(--cream-yellow)] relative overflow-hidden",
          "shadow-sm"
        )}
      >
        {/* Image container with small padding for book margins */}
        <div className="absolute inset-1 rounded-sm overflow-hidden">
          <Image
            src={imageUrl}
            alt={alt}
            fill
            sizes="(max-width: 640px) 90vw, 224px"
            className="object-cover"
            priority={priority}
          />
        </div>
      </div>
    );
  }
);

LandingFlipbookPage.displayName = 'LandingFlipbookPage';

export default LandingFlipbookPage;
