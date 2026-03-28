"use client";

import { Button } from "@/components/ui/button";
import Image from "next/image";
import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useTranslations } from 'next-intl';
import { AnimatedHeroText } from "@/components/ui/animated-hero-text";
import { EXAMPLE_BOOKS, ExampleBook } from "@/components/landing-page/example-books-data";

// Lazy load components
const ExampleBookSelector = dynamic(() => import("@/components/landing-page/example-book-selector"), {
  ssr: false,
  loading: () => (
    <div className="flex justify-center gap-4">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="w-[140px] h-[140px] md:w-[180px] md:h-[180px] bg-[var(--cream-yellow)] rounded-xl animate-pulse" />
      ))}
    </div>
  ),
});

const ExampleBookOverlay = dynamic(() => import("@/components/landing-page/example-book-overlay"), {
  ssr: false,
});

export default function Home() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const t = useTranslations('landing');
  const tc = useTranslations('common');
  const [isButtonLoading, setIsButtonLoading] = useState(true);
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);
  const [selectedBook, setSelectedBook] = useState<ExampleBook | null>(null);

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
    { question: t('faq1Q'), answer: t('faq1A') },
    { question: t('faq2Q'), answer: t('faq2A') },
    { question: t('faq3Q'), answer: t('faq3A') },
    { question: t('faq4Q'), answer: t('faq4A') },
    { question: t('faq5Q'), answer: t('faq5A') },
  ];

  return (
    <div className="flex flex-col min-h-screen relative">
      <main className="flex-grow relative z-10">
        {/* Hero Section */}
        <section className="text-center px-4 py-8 md:py-12 relative">
          <div className="max-w-4xl mx-auto">
            <AnimatedHeroText />

            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-300 mb-5 max-w-2xl mx-auto">
              {t('heroSubtitle')}
            </p>

            <div className="flex flex-col sm:flex-row justify-center items-center gap-3 mb-6">
              <Button
                size="lg"
                variant="default"
                className="w-full sm:w-auto px-8 py-3 md:px-10 md:py-4 text-lg md:text-xl bg-[#F76C5E] text-white hover:bg-[#e55d4f] transition-all rounded-full font-playful group"
                onClick={handleCreateStorybookClick}
                disabled={!isLoaded}
              >
                {isButtonLoading ? tc('loading') : (
                  <>
                    <svg
                      className="mr-2 h-5 w-5 transition-transform group-hover:scale-125 group-hover:rotate-12"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M12 0L14.59 8.41L23 11L14.59 13.59L12 22L9.41 13.59L1 11L9.41 8.41L12 0Z" />
                    </svg>
                    {t('createYourStorybook')}
                  </>
                )}
              </Button>
            </div>

            <div className="mt-22 md:mt-24 mb-8 md:mb-12">
              <ExampleBookSelector
                books={EXAMPLE_BOOKS}
                onSelectBook={setSelectedBook}
              />
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="py-6 md:py-12 px-4">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 dark:text-white text-center mb-8 md:mb-12">
              <span className="font-playful">{t('howItWorksPrefix')}</span>{' '}
              <span className="font-playful" style={{ color: '#F76C5E' }}>{t('howItWorksSuffix')}</span>
            </h2>
            <Image
              src="https://res.cloudinary.com/storywink/image/upload/v1774702929/use-this-how-to_vq0hey.png"
              alt={t('howItWorksAlt')}
              width={1200}
              height={600}
              className="w-full h-auto"
              priority={false}
            />
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-6 md:py-12 px-4">
          <div className="text-center mb-8 md:mb-12">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-4">
              <Image
                src="https://res.cloudinary.com/storywink/image/upload/v1772291623/Screenshot_2026-02-28_at_11.12.00_PM_df2xpk.png"
                alt="Kai the Dino FAQ"
                width={240}
                height={240}
                className="h-24 w-24 md:h-[120px] md:w-[120px]"
              />
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-900 dark:text-white">
                {t('faq')}
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
        <ExampleBookOverlay
          book={selectedBook}
          onClose={() => setSelectedBook(null)}
          onCtaClick={handleCreateStorybookClick}
        />
      </main>
    </div>
  );
}
