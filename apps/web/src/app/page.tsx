"use client";

import { Button } from "@/components/ui/button";
import Image from "next/image";
import React, { useRef, useEffect, useState, useContext, createContext, memo } from 'react';
import { cn } from "@/lib/utils";
import dynamic from 'next/dynamic';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { AnimatedHeroText } from "@/components/ui/animated-hero-text";
import { optimizeCloudinaryUrl } from '@storywink/shared';
import StorybookFrame from "@/components/ui/storybook-frame";
import PlayfulBackground from "@/components/ui/playful-background";

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
  { original: optimizeCloudinaryUrl("https://res.cloudinary.com/storywink/image/upload/v1764315536/user_user_2vuIux03jMcwJQMhRqWBrXuaAET/uploads/IMG_3244_rwy5uf.jpg"), illustrated: optimizeCloudinaryUrl("https://res.cloudinary.com/storywink/image/upload/v1764315803/storywink/cmiijx5dg004vmr0diwd3t9w8/generated/page_8.jpg"), alt: "Photo 1" },
  { original: optimizeCloudinaryUrl("https://res.cloudinary.com/storywink/image/upload/v1764315538/user_user_2vuIux03jMcwJQMhRqWBrXuaAET/uploads/IMG_3269_tcrmzo.jpg"), illustrated: optimizeCloudinaryUrl("https://res.cloudinary.com/storywink/image/upload/v1764315829/storywink/cmiijx5dg004vmr0diwd3t9w8/generated/page_10.jpg"), alt: "Photo 2" },
  { original: optimizeCloudinaryUrl("https://res.cloudinary.com/storywink/image/upload/v1764315531/user_user_2vuIux03jMcwJQMhRqWBrXuaAET/uploads/IMG_3336_ilx9fd.jpg"), illustrated: optimizeCloudinaryUrl("https://res.cloudinary.com/storywink/image/upload/v1764315742/storywink/cmiijx5dg004vmr0diwd3t9w8/generated/page_4.jpg"), alt: "Photo 3" },
];

// Placeholder data for the second carousel (first 3 images for top display)
const carouselImagesStyle2 = [
  { original: optimizeCloudinaryUrl("https://res.cloudinary.com/storywink/image/upload/v1764255047/user_user_2vuIux03jMcwJQMhRqWBrXuaAET/uploads/WhatsApp_Image_2025-10-19_at_13.41.03_1_cprzju.jpg"), illustrated: optimizeCloudinaryUrl("https://res.cloudinary.com/storywink/image/upload/v1764255352/storywink/cmihjwm8l002bmr0dp7lhdvx2/generated/page_2.jpg"), alt: "Photo 4" },
  { original: optimizeCloudinaryUrl("https://res.cloudinary.com/storywink/image/upload/v1764255046/user_user_2vuIux03jMcwJQMhRqWBrXuaAET/uploads/WhatsApp_Image_2025-10-19_at_13.41.04_2_moijbz.jpg"), illustrated: optimizeCloudinaryUrl("https://res.cloudinary.com/storywink/image/upload/v1764255446/storywink/cmihjwm8l002bmr0dp7lhdvx2/generated/page_9.jpg"), alt: "Photo 5" },
  { original: optimizeCloudinaryUrl("https://res.cloudinary.com/storywink/image/upload/v1764253791/user_user_2vuIux03jMcwJQMhRqWBrXuaAET/uploads/WhatsApp_Image_2025-10-19_at_13.41.03_h21hc7.jpg"), illustrated: optimizeCloudinaryUrl("https://res.cloudinary.com/storywink/image/upload/v1764255443/storywink/cmihjwm8l002bmr0dp7lhdvx2/generated/page_7.jpg"), alt: "Photo 6" },
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

  // Preload next image pair before carousel transitions
  useEffect(() => {
    const nextIndex = (currentIndex + 1) % images.length;
    const nextImage = images[nextIndex];

    if (nextImage && typeof window !== 'undefined') {
      const preloadOriginal = new window.Image();
      preloadOriginal.src = nextImage.original;
      const preloadIllustrated = new window.Image();
      preloadIllustrated.src = nextImage.illustrated;
    }
  }, [currentIndex, images]);

  if (!images || images.length === 0) return null;

  const currentImagePair = images[currentIndex % images.length]; // Use modulo for safety if lengths differ despite totalImages
  const isFirstImage = currentIndex === 0;

  return (
    <div className={cn("relative w-full max-w-md mx-auto flex flex-col items-center")} style={{ maxWidth: '28rem' }}>
      {/* Storybook-style frame with hand-drawn border */}
      <StorybookFrame
        className="w-full shadow-md"
        borderColor="var(--coral-primary)"
        backgroundColor="var(--cream-yellow)"
        key={`${carouselId}-${currentIndex}`}
      >
        <div className="flex flex-row w-full gap-3">
          {/* Original photo side */}
          <div className="w-1/2 relative">
            <div className="aspect-square w-full relative rounded-lg overflow-hidden shadow-sm">
              <Image
                src={currentImagePair.original}
                alt={`${currentImagePair.alt} - Original`}
                fill
                sizes="(max-width: 640px) 45vw, 180px"
                className="object-cover"
                priority={isFirstImage}
              />
            </div>
          </div>
          {/* Illustrated side */}
          <div className="w-1/2 relative">
            <div className="aspect-square w-full relative rounded-lg overflow-hidden shadow-sm">
              <Image
                src={currentImagePair.illustrated}
                alt={`${currentImagePair.alt} - Illustrated`}
                fill
                sizes="(max-width: 640px) 45vw, 180px"
                className="object-cover"
                priority={isFirstImage}
              />
            </div>
          </div>
        </div>
      </StorybookFrame>

      {showControls && totalImages > 1 && (
        <div className="flex items-center justify-center mt-3 space-x-2">
          {Array.from({ length: totalImages }).map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              className={cn(
                "h-2 w-2 rounded-full transition-all duration-200",
                currentIndex === idx
                  ? "bg-[var(--coral-primary)] scale-110"
                  : "bg-[#D9D9D9] hover:bg-[#BFBFBF]"
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
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const [isButtonLoading, setIsButtonLoading] = useState(true);
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);

  // Handle loading state for the button
  useEffect(() => {
    if (isLoaded) {
      setIsButtonLoading(false);
    }
  }, [isLoaded]);

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
    <div className="flex flex-col min-h-screen relative" style={{ backgroundColor: 'var(--bg-playful)' }}>
      {/* Whimsical background decorations */}
      <PlayfulBackground variant="default" showCornerDoodles={false} />

      <main className="flex-grow relative z-10">
        {/* Hero Section */}
        <section className="text-center px-4 py-8 md:py-12 relative">
          <div className="max-w-4xl mx-auto">
            <AnimatedHeroText />

            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 mb-5 max-w-2xl mx-auto">
              Upload photos, and let <span className="font-bold font-playful">Storywin<span className="text-[#F76C5E]">k.ai</span></span> turn everyday adventures into charming stories.
            </p>

            <div className="flex flex-col sm:flex-row justify-center items-center gap-3 mb-6">
              <Button
                size="lg"
                variant="default"
                className="w-full sm:w-auto px-8 py-3 md:px-10 md:py-4 text-lg md:text-xl bg-[#F76C5E] text-white hover:bg-[#F76C5E]/90 transition-colors rounded-full font-playful"
                onClick={handleCreateStorybookClick}
                disabled={!isLoaded}
              >
                {isButtonLoading ? "Loading..." : "✨ Create Your Storybook"}
              </Button>
            </div>

            <div className="mb-2 mt-3">
              <SynchronizedCarousels imageSets={[firstCarouselImages, secondCarouselImages]} interval={6000}>
                <div className="grid grid-cols-1 gap-6 md:gap-8 items-start">
                  <SynchronizedBeforeAfterPair images={firstCarouselImages} showControls={false} carouselId="carousel1" />
                  <SynchronizedBeforeAfterPair images={secondCarouselImages} carouselId="carousel2" />
                </div>
              </SynchronizedCarousels>
            </div>

            <StatsCounter count={1234} text="stories created" className="mt-5 text-sm text-slate-500" />
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-12 md:py-16 px-4">
          <div className="text-center mb-8 md:mb-12">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-4">
              <Image
                src="/images/mascot/kai the dino FAQ.png"
                alt="Kai the Dino FAQ"
                width={80}
                height={80}
                className="h-16 w-16 md:h-20 md:w-20"
              />
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 dark:text-white">
                Frequently Asked Questions
              </h2>
            </div>
          </div>

          <div className="max-w-3xl mx-auto space-y-4">
            {faqItems.map((item, index) => (
              <div
                key={index}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border-l-4 overflow-hidden"
                style={{ borderLeftColor: 'var(--coral-primary)' }}
              >
                <button
                  onClick={() => toggleFAQ(index)}
                  className="w-full p-5 md:p-6 text-left flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <h3 className="text-base md:text-lg font-semibold text-slate-900 dark:text-white pr-4">
                    {item.question}
                  </h3>
                  {expandedFAQ === index ? (
                    <ChevronUp className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--coral-primary)' }} />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-slate-400 flex-shrink-0" />
                  )}
                </button>
                {expandedFAQ === index && (
                  <div className="px-5 md:px-6 pb-5 md:pb-6">
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
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
}
