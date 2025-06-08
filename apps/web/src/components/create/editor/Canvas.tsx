"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import type { EmblaOptionsType, EmblaCarouselType } from 'embla-carousel'; // Import types from base package
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BookWithStoryboardPages } from '@storywink/shared'; // <-- Import shared types

interface CanvasProps {
  bookData: BookWithStoryboardPages; // <-- Use shared type
  options?: EmblaOptionsType;
}

export function Canvas({ bookData, options }: CanvasProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel(options);
  const [prevBtnDisabled, setPrevBtnDisabled] = useState(true);
  const [nextBtnDisabled, setNextBtnDisabled] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // --- Calculate Display Order --- 
  const orderedPagesForDisplay = useMemo(() => {
    if (!bookData?.pages) return [];

    const coverPage = bookData.coverAssetId 
        ? bookData.pages.find(p => p.assetId === bookData.coverAssetId)
        : bookData.pages.find(p => p.isTitlePage); // Fallback to isTitlePage if coverAssetId is null
        
    const otherPages = bookData.pages.filter(p => p.id !== coverPage?.id);

    // Sort the other pages by their database index
    otherPages.sort((a, b) => a.index - b.index);

    // Combine: cover first (if found), then the rest sorted by index
    // If coverPage wasn't found (e.g., initial state, error), just return pages sorted by index
    return coverPage ? [coverPage, ...otherPages] : [...bookData.pages].sort((a, b) => a.index - b.index);

  }, [bookData?.pages, bookData?.coverAssetId]);
  // -----------------------------

  // --- Carousel Navigation --- 
  const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi && emblaApi.scrollNext(), [emblaApi]);
  const scrollTo = useCallback((index: number) => emblaApi && emblaApi.scrollTo(index), [emblaApi]);

  // Use the EmblaCarouselType directly
  const onSelect = useCallback((currentEmblaApi: EmblaCarouselType) => {
    setSelectedIndex(currentEmblaApi.selectedScrollSnap());
    setPrevBtnDisabled(!currentEmblaApi.canScrollPrev());
    setNextBtnDisabled(!currentEmblaApi.canScrollNext());
  }, []);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect(emblaApi);
    emblaApi.on('select', onSelect);
  }, [emblaApi, onSelect]);

  return (
    <div className="relative w-full max-w-sm mx-auto my-4 md:my-0 md:max-w-md">
      <div className="overflow-hidden rounded-lg shadow-lg bg-gray-200" ref={emblaRef}>
        <div className="flex"> {/* Embla container */}
          {orderedPagesForDisplay.map((page, displayIndex) => (
            <div 
              key={page.id} 
              className="relative flex-[0_0_100%] aspect-square bg-white"
            >
              {(page.asset?.url || page.originalImageUrl) ? (
                <Image
                  src={page.asset?.url || page.originalImageUrl || ''}
                  alt={`Page ${displayIndex + 1}`}
                  fill
                  style={{ objectFit: "cover" }}
                  priority={displayIndex < 2}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-400">
                  Missing Image
                </div>
              )}
              
              {/* Title Overlay - Now simplified, as cover is always first */}
              {displayIndex === 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 p-4">
                  <h2 className="text-white text-2xl md:text-3xl font-bold text-center shadow-text">
                    {bookData.title && bookData.title.trim() !== '' 
                      ? bookData.title 
                      : "Insert Title in Details below"
                    }
                  </h2>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Navigation Buttons */}
      <Button
        variant="outline"
        size="icon"
        className="hidden md:flex absolute top-1/2 -translate-y-1/2 left-1 md:left-[-40px] z-10 rounded-full shadow-md bg-white/80 hover:bg-white disabled:opacity-50 items-center justify-center"
        onClick={scrollPrev}
        disabled={prevBtnDisabled}
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        className="hidden md:flex absolute top-1/2 -translate-y-1/2 right-1 md:right-[-40px] z-10 rounded-full shadow-md bg-white/80 hover:bg-white disabled:opacity-50 items-center justify-center"
        onClick={scrollNext}
        disabled={nextBtnDisabled}
      >
        <ArrowRight className="h-5 w-5" />
      </Button>
      
      {/* Dot Navigation */}
      <div className="pt-4 flex justify-center items-center gap-2"> 
        {orderedPagesForDisplay.map((_, index) => (
          <button 
            key={index} 
            onClick={() => scrollTo(index)}
            className={cn(
              "w-2 h-2 rounded-full transition-colors duration-200 ease-in-out",
              index === selectedIndex ? 'bg-[#F76C5E]' : 'bg-gray-300 hover:bg-gray-400' // Coral color for active dot
            )}
            aria-label={`Go to page ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

export default Canvas;
 