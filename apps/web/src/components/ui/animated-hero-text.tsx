"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";

interface RotatingItem {
  word: string;
  image?: {
    src: string;
    alt: string;
    width?: number;
    height?: number;
  };
}

interface AnimatedHeroTextProps {
  staticTextBefore?: string;
  rotatingWords?: string[];
  rotatingItems?: RotatingItem[];
  className?: string;
  interval?: number;
  showBottomText?: boolean;
  imagePosition?: 'above' | 'below' | 'left' | 'right';
  imageSize?: 'sm' | 'md' | 'lg';
}

function AnimatedHeroText({ 
  staticTextBefore: _staticTextBefore = "Turn Memories Into a Picturebook Starring Your Little", 
  rotatingWords = ["Hero", "Princess", "Adventurer", "Explorer", "Firefighter"],
  rotatingItems,
  className = "",
  interval = 2500,
  showBottomText = false,
  imagePosition = 'above',
  imageSize = 'md'
}: AnimatedHeroTextProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isClient, setIsClient] = useState(false);
  
  // Use rotatingItems if provided, otherwise convert rotatingWords to simple items
  const items: RotatingItem[] = useMemo(() => {
    if (rotatingItems) return rotatingItems;
    return rotatingWords.map(word => ({ word }));
  }, [rotatingItems, rotatingWords]);

  // Handle client-side mounting to avoid hydration issues
  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;
    
    const timeoutId = setTimeout(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % items.length);
    }, interval);
    
    return () => clearTimeout(timeoutId);
  }, [currentIndex, items.length, interval, isClient]);

  const imageSizeClasses = {
    sm: 'w-12 h-12 sm:w-16 sm:h-16',
    md: 'w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24',
    lg: 'w-20 h-20 sm:w-24 sm:h-24 md:w-32 md:h-32'
  };

  const currentItem = items[currentIndex];
  const hasImages = items.some(item => item.image);

  const AnimatedContent = () => (
    <div className={`${
      imagePosition === 'left' ? 'flex items-center justify-center gap-4' :
      imagePosition === 'right' ? 'flex items-center justify-center gap-4 flex-row-reverse' :
      'flex flex-col items-center justify-center gap-2'
    }`}>
      
      {/* Image */}
      {hasImages && (imagePosition === 'above' || imagePosition === 'left' || imagePosition === 'right') && (
        <div className={`${imageSizeClasses[imageSize]} flex items-center justify-center`}>
          {isClient ? (
            <AnimatePresence mode="wait">
              {currentItem.image && (
                <motion.div
                  key={`image-${currentIndex}`}
                  className="relative w-full h-full"
                  initial={{ opacity: 0, scale: 0.8, rotate: -10 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.8, rotate: 10 }}
                  transition={{
                    duration: 0.6,
                    ease: "easeInOut"
                  }}
                >
                  <Image
                    src={currentItem.image.src}
                    alt={currentItem.image.alt}
                    fill
                    className="object-contain"
                    sizes="(max-width: 768px) 64px, 96px"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          ) : (
            currentItem.image && (
              <div className="relative w-full h-full">
                <Image
                  src={currentItem.image.src}
                  alt={currentItem.image.alt}
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 64px, 96px"
                />
              </div>
            )
          )}
        </div>
      )}

      {/* Text */}
      <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold min-h-[1.2em] flex items-center justify-center">
        {isClient ? (
          <AnimatePresence mode="wait">
            <motion.span
              key={currentIndex}
              className="inline-block font-bold font-playful"
              style={{ color: '#F76C5E' }}
              initial={{ opacity: 0, y: 30, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -30, scale: 0.8 }}
              transition={{
                duration: 0.6,
                ease: "easeInOut"
              }}
            >
              {currentItem.word}
            </motion.span>
          </AnimatePresence>
        ) : (
          <span className="inline-block font-bold font-playful" style={{ color: '#F76C5E' }}>
            {currentItem.word}
          </span>
        )}
      </div>

      {/* Image Below */}
      {hasImages && imagePosition === 'below' && (
        <div className={`${imageSizeClasses[imageSize]} flex items-center justify-center`}>
          {isClient ? (
            <AnimatePresence mode="wait">
              {currentItem.image && (
                <motion.div
                  key={`image-${currentIndex}`}
                  className="relative w-full h-full"
                  initial={{ opacity: 0, scale: 0.8, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: -20 }}
                  transition={{
                    duration: 0.6,
                    ease: "easeInOut"
                  }}
                >
                  <Image
                    src={currentItem.image.src}
                    alt={currentItem.image.alt}
                    fill
                    className="object-contain"
                    sizes="(max-width: 768px) 64px, 96px"
                  />
                </motion.div>
              )}
            </AnimatePresence>
          ) : (
            currentItem.image && (
              <div className="relative w-full h-full">
                <Image
                  src={currentItem.image.src}
                  alt={currentItem.image.alt}
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 64px, 96px"
                />
              </div>
            )
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={`text-center ${className}`}>
      <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-bold text-slate-900 dark:text-white mb-2 leading-tight px-2">
        <span className="block sm:inline">Turn Memories Into a</span>{' '}
        <span className="block sm:inline">Picturebook Starring</span>{' '}
        <span className="whitespace-nowrap">Your Little</span>
      </h1>
      
      <div className="mb-3 md:mb-4">
        <AnimatedContent />
      </div>
      
      {showBottomText && (
        <p className="text-xl sm:text-2xl md:text-3xl font-bold text-slate-900 dark:text-white">
          in Their Own Storybook
        </p>
      )}
    </div>
  );
}

export { AnimatedHeroText, type RotatingItem }; 