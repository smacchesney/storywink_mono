'use client';

import Image from 'next/image';
import React, { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AnimatedHeroText } from '@/components/ui/animated-hero-text';
import PlayfulBackground from '@/components/ui/playful-background';
import { ScallopEdge } from '@/components/ui/scallop-edge';
import { EXAMPLE_BOOKS, ExampleBook } from '@/components/landing-page/example-books-data';
import { LandingCta } from '@/components/landing-page/landing-cta';
import PhotoToBookMorph from '@/components/landing-page/photo-to-book-morph';
import KeepsakeSection from '@/components/landing-page/keepsake-section';
import LandingStickyCta from '@/components/landing-page/landing-sticky-cta';
import { cn } from '@/lib/utils';

// Lazy load components
const ExampleBookSelector = dynamic(
  () => import('@/components/landing-page/example-book-selector'),
  {
    ssr: false,
    loading: () => (
      <div className="flex justify-center gap-4">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-[140px] w-[140px] animate-pulse rounded-xl bg-[var(--cream-yellow)] md:h-[180px] md:w-[180px]"
          />
        ))}
      </div>
    ),
  },
);

const ExampleBookOverlay = dynamic(() => import('@/components/landing-page/example-book-overlay'), {
  ssr: false,
});

// The mascot duo (cream cat + black-and-tan dog) — the same asset the site
// header uses, at final-band size.
const MASCOT_DUO_SRC =
  'https://res.cloudinary.com/storywink/image/upload/f_auto,q_auto,w_480/v1772291379/Screenshot_2026-02-28_at_10.55.32_PM_copy_xxjms6.png';

// How-it-works vignettes. Honest interim art: the existing mascot sprite
// crops (+ the painting cat) until the owner uploads the four dedicated
// pieces at storywink/landing/howitworks-step{1..4}.png — swap the URLs the
// day they exist, nothing else changes.
const HOW_IT_WORKS_IMAGES = [
  'https://res.cloudinary.com/storywink/image/upload/c_crop,x_100,y_540,w_880,h_700/f_auto,q_auto,w_520/v1774702929/use-this-how-to_vq0hey.png',
  'https://res.cloudinary.com/storywink/image/upload/f_auto,q_auto,w_520/v1772291377/Screenshot_2026-02-28_at_10.57.58_PM_mijhwv.png',
  'https://res.cloudinary.com/storywink/image/upload/c_crop,x_1060,y_530,w_900,h_740/f_auto,q_auto,w_520/v1774702929/use-this-how-to_vq0hey.png',
  'https://res.cloudinary.com/storywink/image/upload/c_crop,x_2075,y_540,w_900,h_720/f_auto,q_auto,w_520/v1774702929/use-this-how-to_vq0hey.png',
];

export default function Home() {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const t = useTranslations('landing');
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);
  const [selectedBook, setSelectedBook] = useState<ExampleBook | null>(null);
  const heroCtaRef = useRef<HTMLDivElement>(null);
  const finalBandRef = useRef<HTMLElement>(null);

  // Always live — route optimistically to /create; middleware bounces to
  // sign-in when the session turns out to be missing.
  const handleCreateStorybookClick = () => {
    if (isLoaded && !isSignedIn) {
      router.push(`/sign-in?redirect_url=${encodeURIComponent('/create')}`);
    } else {
      router.push('/create');
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
    { question: t('faq6Q'), answer: t('faq6A') },
  ];

  const howItWorksSteps = [1, 2, 3, 4].map((n) => ({
    n,
    img: HOW_IT_WORKS_IMAGES[n - 1],
    title: t(`step${n}Title`),
    caption: t(`step${n}Caption`),
  }));

  return (
    <div className="relative">
      <PlayfulBackground variant="landing" />
      <div className="relative z-10">
        {/* 1. Hero */}
        <section className="relative overflow-x-clip px-4 pt-8 pb-16 md:pt-14 md:pb-24">
          <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-14">
            <div className="text-center lg:text-left">
              <AnimatedHeroText
                lead={t('heroLead')}
                trail={t('heroTrail')}
                rotatingWords={[
                  t('heroWord1'),
                  t('heroWord2'),
                  t('heroWord3'),
                  t('heroWord4'),
                  t('heroWord5'),
                ]}
              />

              <p className="mx-auto mt-5 max-w-xl text-base text-ink-soft sm:text-lg lg:mx-0">
                {t('heroSubtitle')}
              </p>

              <div ref={heroCtaRef} className="mt-6">
                <LandingCta onClick={handleCreateStorybookClick} className="lg:items-start" />
              </div>
            </div>

            <PhotoToBookMorph
              book={EXAMPLE_BOOKS[0]}
              onOpen={() => setSelectedBook(EXAMPLE_BOOKS[0])}
            />
          </div>
        </section>

        {/* 2. Proof: example-book fan + likeness line */}
        <section className="px-4 py-16 md:py-24">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="text-2xl font-bold sm:text-3xl md:text-4xl">
              <span className="font-playful text-ink">{t('proofPrefix')}</span>{' '}
              <span className="font-playful text-coral">{t('proofSuffix')}</span>
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-ink-soft">{t('proofSub')}</p>

            <div className="mt-10 md:mt-14">
              <ExampleBookSelector books={EXAMPLE_BOOKS} onSelectBook={setSelectedBook} />
            </div>

            <p className="mx-auto mt-10 max-w-2xl text-ink-soft">{t('likenessLine')}</p>

            <div className="mt-8">
              <LandingCta variant="ghost" onClick={handleCreateStorybookClick} />
            </div>
          </div>
        </section>

        {/* 3. How it works + CTA block */}
        <section className="px-4 py-16 md:py-24">
          <div className="mx-auto max-w-5xl">
            <h2 className="mb-10 text-center text-2xl font-bold text-ink sm:text-3xl md:mb-14 md:text-4xl">
              <span className="font-playful">{t('howItWorksPrefix')}</span>{' '}
              <span className="font-playful text-coral">{t('howItWorksSuffix')}</span>
            </h2>

            <ol className="relative grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-8 lg:grid-cols-4 lg:gap-6">
              {/* Dotted connector across the four steps (wide desktop only —
                  on the md 2×2 grid it would cut between rows) */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-6 right-0 left-0 hidden border-t-2 border-dashed border-coral/30 lg:block"
                style={{ marginLeft: '12.5%', marginRight: '12.5%' }}
              />

              {howItWorksSteps.map((step) => (
                <li key={step.n} className="relative flex flex-col items-center text-center">
                  {/* Number badge */}
                  <span className="relative z-10 mb-4 flex h-12 w-12 items-center justify-center rounded-full border-2 border-coral bg-white font-playful text-xl font-bold text-coral shadow-sm">
                    {step.n}
                  </span>
                  {/* Mascot vignette — transparent art straight on the playful
                      background, over a soft coral radial blob */}
                  <div className="mb-4 flex h-40 w-full items-end justify-center bg-[radial-gradient(closest-side,rgba(247,108,94,0.08),transparent)] sm:h-44">
                    <Image
                      src={step.img}
                      alt={step.title}
                      width={260}
                      height={200}
                      className="h-full w-auto object-contain"
                    />
                  </div>
                  <h3 className="mb-1 font-playful text-xl text-ink">{step.title}</h3>
                  <p className="max-w-[15rem] text-sm text-ink-soft">{step.caption}</p>
                </li>
              ))}
            </ol>

            <div className="mt-12 md:mt-16">
              <LandingCta onClick={handleCreateStorybookClick} />
              <p className="mt-3 text-center text-sm text-ink-soft">{t('hiwReassurance')}</p>
            </div>
          </div>
        </section>

        {/* 4. Keepsake ladder (print USP) — carries its own scallop dividers */}
        <KeepsakeSection onCtaClick={handleCreateStorybookClick} />

        {/* 5. Safety line + FAQ */}
        <section className="px-4 py-16 md:py-24">
          <p className="mx-auto mb-8 max-w-xl text-center text-ink-soft md:mb-10">
            {t('safetyLine')}
          </p>

          <div className="mb-8 text-center md:mb-12">
            <div className="mb-4 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <Image
                src="https://res.cloudinary.com/storywink/image/upload/f_auto,q_auto,h_240/v1772291623/Screenshot_2026-02-28_at_11.12.00_PM_df2xpk.png"
                alt={t('faqMascotAlt')}
                width={240}
                height={240}
                className="h-24 w-24 md:h-[120px] md:w-[120px]"
              />
              <h2 className="text-2xl font-bold text-ink sm:text-3xl md:text-4xl">
                <span className="font-playful">{t('faqPrefix')}</span>{' '}
                <span className="font-playful text-coral">{t('faqSuffix')}</span>
              </h2>
            </div>
          </div>

          <div className="mx-auto max-w-3xl space-y-3">
            {faqItems.map((item, index) => {
              const isOpen = expandedFAQ === index;
              return (
                <div
                  key={index}
                  className={cn(
                    'overflow-hidden rounded-2xl border bg-white shadow-sm transition-colors',
                    isOpen ? 'border-coral/40' : 'border-ink/10',
                  )}
                >
                  <button
                    onClick={() => toggleFAQ(index)}
                    aria-expanded={isOpen}
                    aria-controls={`faq-answer-${index}`}
                    className="flex min-h-[44px] w-full cursor-pointer items-center justify-between p-4 text-left transition-colors hover:bg-coral-soft/40 md:p-5"
                  >
                    <h3 className="pr-4 font-playful text-base text-ink md:text-lg">
                      {item.question}
                    </h3>
                    <ChevronDown
                      className={cn(
                        'h-5 w-5 flex-shrink-0 transition-transform motion-reduce:transition-none',
                        isOpen ? 'rotate-180 text-coral' : 'text-ink-soft/60',
                      )}
                    />
                  </button>
                  {/* Always rendered (SEO); eases open via the grid-rows trick */}
                  <div
                    id={`faq-answer-${index}`}
                    className={cn(
                      'grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none',
                      isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                    )}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <p className="px-4 pt-0 pb-4 text-[15px] leading-relaxed text-ink-soft md:px-5 md:text-base">
                        {item.answer}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 6. Final ask band — peach, abuts the footer (its -mb cancels the
            footer's top margin so no cream gap remains) */}
        <section ref={finalBandRef} className="relative -mb-20">
          <ScallopEdge flip fill="#FBE7D6" className="relative z-10 block" />
          <div className="-mt-px bg-[#FBE7D6] px-4 py-16 text-center md:py-24">
            <Image
              src={MASCOT_DUO_SRC}
              alt={t('faqMascotAlt')}
              width={240}
              height={192}
              className="mx-auto h-auto w-40 md:w-56"
            />
            <h2 className="mt-6 font-playful text-2xl font-bold text-ink sm:text-3xl md:text-4xl">
              {t('finalTitle')}
            </h2>
            <div className="mt-8">
              <LandingCta onClick={handleCreateStorybookClick} />
            </div>
          </div>
        </section>

        <LandingStickyCta
          heroCtaRef={heroCtaRef}
          finalBandRef={finalBandRef}
          suppressed={selectedBook !== null}
          onCtaClick={handleCreateStorybookClick}
        />

        <ExampleBookOverlay
          book={selectedBook}
          onClose={() => setSelectedBook(null)}
          onCtaClick={handleCreateStorybookClick}
        />
      </div>
    </div>
  );
}
