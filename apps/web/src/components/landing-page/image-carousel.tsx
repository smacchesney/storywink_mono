"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import type { StyleDefinition } from '@storywink/shared';
import { Loader2 } from 'lucide-react'; // Import Loader2 if needed for loading state

interface ImagePair {
  original: string;
  illustrated: string;
  alt: string;
}

interface ImageCarouselProps {
  imagePairs: ImagePair[];
  interval?: number; // Interval in milliseconds
  className?: string;
  showMascot?: boolean; // Added prop to control mascot visibility
}

const ImageCarousel: React.FC<ImageCarouselProps> = ({
  imagePairs,
  interval = 5000, // Default to 5 seconds
  className,
  showMascot = true, // Default to true
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true); // Track initial loading

  useEffect(() => {
    if (!imagePairs || imagePairs.length === 0) return;

    const timer = setInterval(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % imagePairs.length);
    }, interval);

    return () => clearInterval(timer); // Cleanup interval on component unmount
  }, [currentIndex, imagePairs, interval]);

  useEffect(() => {
    // Reset loading state when images change (optional but good practice)
    setIsLoading(true);
  }, [imagePairs]);

  if (!imagePairs || imagePairs.length === 0) {
    return null; // Don't render anything if no images are provided
  }

  // Function to handle image loading completion
  const handleLoadingComplete = () => {
     // Could set loading to false only after the first image pair loads
     // For simplicity, we'll rely on Next/Image priority for initial load.
     // If you want a spinner, manage isLoading state more granularly here.
     // setIsLoading(false); 
  };

  return (
    <div className={cn("w-full max-w-2xl mx-auto", className)}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12 items-center justify-items-center">
        {/* Original Image Panel */}
        <div className="relative w-full aspect-square overflow-hidden rounded-lg shadow-lg bg-gray-100"> {/* Added bg for loading state */}
          {imagePairs.map((pair, index) => {
            const isCurrent = index === currentIndex;
            // Preload logic: render current and next image
            // More advanced: render current, next, and previous for smoother back/forth
            const shouldRender = isCurrent || index === (currentIndex + 1) % imagePairs.length;
            if (!shouldRender) return null; // Don't render others
            
            return (
              <Image
                key={`${pair.original}-original-${index}`}
                src={pair.original}
                alt={`Original: ${pair.alt}`}
                fill
                sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw" // Adjusted sizes
                className={cn(
                  "absolute inset-0 object-cover transition-opacity duration-700 ease-in-out",
                  isCurrent ? "opacity-100 z-10" : "opacity-0 z-5" // Current on top, next behind
                )}
                priority={index === 0} // Prioritize first image
                onLoadingComplete={handleLoadingComplete} // Handle loading
              />
            );
          })}
          <div className="absolute bottom-2 left-2 z-20 bg-black/50 text-white text-xs font-semibold px-2 py-1 rounded pointer-events-none">
            Original Photo
          </div>
        </div>

        {/* Illustrated Image Panel */}
        <div className="relative w-full aspect-square rounded-lg shadow-lg bg-gray-100"> {/* Outer container, Added bg */}
          {/* Conditionally render Action Mascot Image - Always relative to the container */}
          {showMascot && (
             <Image 
               src="/images/mascot/Winky the TREX - action_creating.png"
               alt="Winky creating magic"
               width={80} 
               height={80} 
               className="absolute top-0 right-0 z-30 transform -translate-y-1/4 translate-x-1/4 pointer-events-none" 
             />
          )}
          {/* Sparkle Background - Rendered once behind everything */}
           <Image
             src="/images/assets/Background sparkle.png" 
             alt="Sparkle background"
             fill
             sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw" // Match other images
             className="absolute inset-0 z-0 transform scale-[1.3] object-cover" 
           />

          {/* Inner container for clipping and stacking illustrated images */}
           <div className="absolute inset-0 z-10 w-full h-full rounded-lg overflow-hidden"> 
              {imagePairs.map((pair, index) => {
                const isCurrent = index === currentIndex;
                const shouldRender = isCurrent || index === (currentIndex + 1) % imagePairs.length;
                if (!shouldRender) return null;

                return (
                  <Image
                    key={`${pair.illustrated}-illustrated-${index}`}
                    src={pair.illustrated}
                    alt={`Illustrated: ${pair.alt}`}
                    fill
                    sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw" // Adjusted sizes
                    className={cn(
                      "absolute inset-0 object-cover transition-opacity duration-700 ease-in-out",
                      isCurrent ? "opacity-100 z-10" : "opacity-0 z-5"
                    )}
                    priority={index === 0} 
                    onLoadingComplete={handleLoadingComplete}
                  />
                );
              })}
           </div>
           {/* Label - Stays on top */}
           <div className="absolute bottom-2 left-2 z-20 bg-[#F76C5E]/80 text-white text-xs font-semibold px-2 py-1 rounded pointer-events-none">
            Storywink Style!
          </div>
        </div>
      </div>
       {/* Optional: Dots for indicating current image */}
       <div className="flex justify-center mt-4 space-x-2">
         {imagePairs.map((_, index) => (
           <button
             key={index}
             onClick={() => setCurrentIndex(index)}
             className={cn(
               'h-2 w-2 rounded-full transition-colors',
               index === currentIndex ? 'bg-[#F76C5E]' : 'bg-gray-300 hover:bg-gray-400'
             )}
             aria-label={`Go to image ${index + 1}`}
           />
         ))}
       </div>
    </div>
  );
};

export default ImageCarousel; 