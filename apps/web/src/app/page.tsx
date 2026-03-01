"use client";

import { Button } from "@/components/ui/button";
import Image from "next/image";
import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { AnimatedHeroText } from "@/components/ui/animated-hero-text";
import { EXAMPLE_BOOKS, ExampleBook } from "@/components/landing-page/example-books-data";

// Lazy load components
const StatsCounter = dynamic(() => import("@/components/landing-page/stats-counter"), {
  loading: () => <div className="h-6" />,
});

const ExampleBookSelector = dynamic(() => import("@/components/landing-page/example-book-selector"), {
  ssr: false,
  loading: () => (
    <div className="flex justify-center gap-4">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="w-[120px] h-[120px] md:w-[180px] md:h-[180px] bg-[var(--cream-yellow)] rounded-xl animate-pulse" />
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
    <div className="flex flex-col min-h-screen relative">
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
                className="w-full sm:w-auto px-8 py-3 md:px-10 md:py-4 text-lg md:text-xl bg-[#F76C5E] text-white hover:bg-[#e55d4f] transition-all rounded-full font-playful group"
                onClick={handleCreateStorybookClick}
                disabled={!isLoaded}
              >
                {isButtonLoading ? "Loading..." : (
                  <>
                    <svg
                      className="mr-2 h-5 w-5 transition-transform group-hover:scale-125 group-hover:rotate-12"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M12 0L14.59 8.41L23 11L14.59 13.59L12 22L9.41 13.59L1 11L9.41 8.41L12 0Z" />
                    </svg>
                    Create Your Storybook
                  </>
                )}
              </Button>
            </div>

            <div className="mb-2 mt-3">
              <ExampleBookSelector
                books={EXAMPLE_BOOKS}
                onSelectBook={setSelectedBook}
              />
            </div>

            <StatsCounter count={1234} text="stories created" className="mt-5 text-sm text-slate-500" />
          </div>
        </section>

        {/* FAQ Section */}
        <section className="py-12 md:py-16 px-4">
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
        <ExampleBookOverlay
          book={selectedBook}
          onClose={() => setSelectedBook(null)}
          onCtaClick={handleCreateStorybookClick}
        />
      </main>
    </div>
  );
}
