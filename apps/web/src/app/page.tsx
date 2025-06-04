"use client";

import { Button } from "@/components/ui/button";
import Image from "next/image";
import React, { useRef, useEffect, useState, useContext, createContext, memo } from 'react';
import { cn } from "@/lib/utils";
import dynamic from 'next/dynamic';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ClerkWrapper } from "@/components/clerk-wrapper";
import { useRouter } from "next/navigation";
import { AnimatedHeroText } from "@/components/ui/animated-hero-text";

// Lazy load components
const StatsCounter = dynamic(() => import("@/components/landing-page/stats-counter"), {
  loading: () => <div className="h-6" />,
});

interface CarouselImage {
  original: string;
  illustrated: string;
  alt: string;
  title?: string; // Optional title to display
}

// Placeholder data for the first carousel (first 3 images for top display)
const carouselImages = [
  { original: "https://res.cloudinary.com/storywink/image/upload/v1746287470/lwyxy1knvyqvvgch2aor_us7fdd.jpg", illustrated: "https://res.cloudinary.com/storywink/image/upload/v1746287481/page_0_ub5h7f.png", alt: "Anime, Title" },
  { original: "https://res.cloudinary.com/storywink/image/upload/v1746287475/euly0y2fcctrcnnmjcq2_qognmp.jpg", illustrated: "https://res.cloudinary.com/storywink/image/upload/v1746287482/page_1_cwhtjo.png", alt: "Anime, Pg 1" },
  { original: "https://res.cloudinary.com/storywink/image/upload/v1746287474/wjz3h46y2mt06vnq47n9_mzpmoy.jpg", illustrated: "https://res.cloudinary.com/storywink/image/upload/v1746287483/page_2_vp0r7f.png", alt: "Anime, Pg 1" },
  // Keep remaining images if needed for other parts, or trim if only first 3 are used for these carousels
];

// Placeholder data for the second carousel (first 3 images for top display)
const carouselImagesStyle2 = [
  { original: "https://res.cloudinary.com/storywink/image/upload/v1746288814/x8oks0akdtyukbltfbyw_snzc3q.jpg", illustrated: "https://res.cloudinary.com/storywink/image/upload/v1746288830/page_0_hchiwz.png", alt: "Title" },
  { original: "https://res.cloudinary.com/storywink/image/upload/v1746288815/yp1gixdr0dy1e9j91h9d_xvfb56.jpg", illustrated: "https://res.cloudinary.com/storywink/image/upload/v1746288831/page_1_tce8np.png", alt: "pg 1" },
  { original: "https://res.cloudinary.com/storywink/image/upload/v1746288816/veqfxfgb4z0nxk9bjiuu_umdhjk.jpg", illustrated: "https://res.cloudinary.com/storywink/image/upload/v1746288819/page_2_xieetj.png", alt: "pg 2" },
  // Keep remaining images if needed for other parts, or trim if only first 3 are used for these carousels
];

interface CarouselSyncContextType {
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  isTransitioning: boolean;
  setIsTransitioning: React.Dispatch<React.SetStateAction<boolean>>;
  totalImages: number;
}

const CarouselSyncContext = createContext<CarouselSyncContextType | undefined>(undefined);

const useCarouselSync = () => {
  const context = useContext(CarouselSyncContext);
  if (!context) {
    throw new Error("useCarouselSync must be used within a SynchronizedCarousels provider");
  }
  return context;
};

interface SynchronizedCarouselsProps {
  children: React.ReactNode;
  imageSets: CarouselImage[][]; // Array of image sets for each carousel
  interval?: number;
}

const SynchronizedCarousels: React.FC<SynchronizedCarouselsProps> = ({ children, imageSets, interval = 4000 }) => {
  const totalImages = Math.min(...imageSets.map(set => set.length)); // Sync based on the smallest set
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % totalImages);
    }, interval);
  };

  useEffect(() => {
    if (totalImages > 0) {
     resetTimer();
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [currentIndex, totalImages, interval]);

  const handleSetCurrentIndex = (index: number) => {
    setCurrentIndex(index);
    resetTimer();
  };
  
  if (totalImages === 0) {
    // Handle case with no images to prevent errors
    return <>{children}</>; 
  }

  return (
    <CarouselSyncContext.Provider value={{ currentIndex, setCurrentIndex: handleSetCurrentIndex, isTransitioning, setIsTransitioning, totalImages }}>
      {children}
    </CarouselSyncContext.Provider>
  );
};

interface SynchronizedBeforeAfterPairProps {
  images: CarouselImage[];
  showControls?: boolean;
  carouselId: string; // Unique ID for this carousel instance for keying
}

const SynchronizedBeforeAfterPair: React.FC<SynchronizedBeforeAfterPairProps> = memo(({ images, showControls = false, carouselId }) => {
  const { currentIndex, setCurrentIndex, totalImages } = useCarouselSync();

  if (!images || images.length === 0) return null;

  const currentImagePair = images[currentIndex % images.length]; // Use modulo for safety if lengths differ despite totalImages

  return (
    <div className={cn("relative w-full max-w-sm mx-auto flex flex-col items-center")} style={{ maxWidth: '24rem' }}>
      <div className={cn(
          "w-full overflow-hidden rounded-2xl shadow-sm bg-[#FFF8E1] relative",
        )}
        style={{ maxWidth: '24rem' }}
        key={`${carouselId}-${currentIndex}`}
      >
        <div className="flex flex-row w-full">
          <div className="w-1/2 relative">
            <div className="aspect-square w-full relative bg-muted">
              <Image
                src={currentImagePair.original}
                alt={`${currentImagePair.alt} - Original`}
                fill
                className="object-cover"
                priority={true}
              />
            </div>
          </div>
          <div className="w-1/2 relative">
            <div className="aspect-square w-full relative bg-muted">
              <Image
                src={currentImagePair.illustrated}
                alt={`${currentImagePair.alt} - Illustrated`}
                fill
                className="object-cover"
                priority={true}
              />
            </div>
          </div>
        </div>
      </div>

      {showControls && totalImages > 1 && (
        <div className="flex items-center justify-center mt-2 space-x-1.5">
          {Array.from({ length: totalImages }).map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              className={cn(
                "h-[5px] w-[5px] rounded-full transition-colors",
                currentIndex === idx 
                  ? "bg-[#FF6B6B]" 
                  : "bg-[#D9D9D9]"
              )}
              aria-label={`Image ${idx + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
});

SynchronizedBeforeAfterPair.displayName = 'SynchronizedBeforeAfterPair';

export default function Home() {
  const firstCarouselImages = carouselImages.slice(0, 3);
  const secondCarouselImages = carouselImagesStyle2.slice(0, 3);
  const router = useRouter();
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);

  const toggleFAQ = (index: number) => {
    setExpandedFAQ(expandedFAQ === index ? null : index);
  };

  const faqItems = [
    {
      question: "How does Storywink.ai create personalized storybooks?",
      answer: "Simply upload photos of your child, and our AI will transform them into beautiful illustrated characters. We then craft engaging stories around their adventures, making them the hero of their own tale."
    },
    {
      question: "What age group is Storywink.ai designed for?",
      answer: "Our storybooks are perfect for toddlers and young children aged 2-8 years old. The stories are crafted with age-appropriate language and themes that engage young minds."
    },
    {
      question: "How long does it take to create a storybook?",
      answer: "Most storybooks are ready within minutes! Our AI works quickly to process your photos and generate beautiful illustrations along with an engaging storyline."
    },
    {
      question: "Can I customize the stories?",
      answer: "Yes! You can guide the story direction, choose themes, and even specify settings or adventures you'd like your child to experience in their personalized storybook."
    },
    {
      question: "Is my child's data and photos safe?",
      answer: "Absolutely. We take privacy seriously and use industry-standard security measures to protect all uploaded photos and personal information. Your data is never shared with third parties."
    }
  ];

  return (
    <ClerkWrapper>
      {({ isLoaded, isSignedIn }) => {
        const handleCreateStorybookClick = () => {
          if (!isLoaded) {
            return;
          }

          if (isSignedIn) {
            router.push("/create");
          } else {
            router.push(`/sign-in?redirect_url=${encodeURIComponent('/create')}`);
          }
        };

        return (
          <div className="flex flex-col min-h-screen bg-white dark:bg-gray-900">
            <main className="flex-grow container mx-auto px-4 py-6 md:py-8 space-y-6 md:space-y-8">
              <section className="text-center">
                <AnimatedHeroText />
                
                <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 mb-5 max-w-2xl mx-auto font-sans">
                  Upload photos, and let <span style={{ fontFamily: 'Excalifont' }} className="font-bold">Storywin<span className="text-[#F76C5E]">k.ai</span></span> turn everyday adventures into charming stories.
                </p>
                
                <div className="flex flex-col sm:flex-row justify-center items-center gap-3 mb-6">
                  <Button
                    size="lg"
                    variant="default"
                    className="w-full sm:w-auto px-8 py-3 md:px-10 md:py-4 text-lg md:text-xl bg-[#F76C5E] text-white hover:bg-[#F76C5E]/90 transition-colors rounded-full"
                    onClick={handleCreateStorybookClick}
                    disabled={!isLoaded}
                    style={{ fontFamily: 'Excalifont' }}
                  >
                    {!isLoaded ? "Loading..." : "✨ Create Your Storybook"}
                  </Button>
                </div>
          
          <div className="mb-2 mt-3">
            <SynchronizedCarousels imageSets={[firstCarouselImages, secondCarouselImages]} interval={4000}>
              <div className="grid grid-cols-1 gap-6 md:gap-8 items-start">
                <SynchronizedBeforeAfterPair images={firstCarouselImages} showControls={false} carouselId="carousel1" />
                <SynchronizedBeforeAfterPair images={secondCarouselImages} carouselId="carousel2" />
              </div>
            </SynchronizedCarousels>
          </div>
          
          <StatsCounter count={1234} text="stories created" className="mt-5 text-sm font-sans text-slate-500" />
        </section>

        {/* FAQ Section */}
        <section className="py-12 md:py-16">
          <div className="text-center mb-8 md:mb-12">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-4">
              <Image
                src="/images/mascot/kai the dino FAQ.png"
                alt="Kai the Dino FAQ"
                width={60}
                height={60}
                className="h-12 w-12 md:h-15 md:w-15"
              />
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 dark:text-white font-sans">
                Frequently Asked Questions
              </h2>
            </div>
          </div>

          <div className="max-w-3xl mx-auto space-y-3">
            {faqItems.map((item, index) => (
              <div key={index} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <button
                  onClick={() => toggleFAQ(index)}
                  className="w-full p-6 text-left flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-white font-sans pr-4">
                    {item.question}
                  </h3>
                  {expandedFAQ === index ? (
                    <ChevronUp className="h-5 w-5 text-slate-500 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-slate-500 flex-shrink-0" />
                  )}
                </button>
                {expandedFAQ === index && (
                  <div className="px-6 pb-6">
                    <p className="text-slate-600 dark:text-slate-300 font-sans leading-relaxed">
                      {item.answer}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
            </section>
          </main>
        </div>
        );
      }}
    </ClerkWrapper>
  );
}
