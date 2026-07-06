'use client';

import React from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { ScallopEdge } from '@/components/ui/scallop-edge';
import StorybookFrame from '@/components/ui/storybook-frame';
import { isPrintShippableLocale } from '@/lib/print-availability';
import { EXAMPLE_BOOKS, getCoverUrl } from './example-books-data';
import { LandingCta } from './landing-cta';

// The cream band colour — matches --cream-deep so the section reads as a
// warmer paper stripe between the playful background sections.
const BAND_FILL = '#FDF1E3';

/** Hand-drawn mini flipbook doodle (tonight — read in the app). */
function FlipbookDoodle() {
  return (
    <svg
      viewBox="0 0 48 32"
      className="h-8 w-12 text-coral"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M24 8 C 18 4, 8 4, 4 7 L 4 26 C 8 23, 18 23, 24 27" />
      <path d="M24 8 C 30 4, 40 4, 44 7 L 44 26 C 40 23, 30 23, 24 27" />
      <path d="M24 8 L 24 27" />
      <path d="M9 12 C 13 11, 17 11, 20 12 M9 17 C 13 16, 17 16, 20 17" />
    </svg>
  );
}

/** Paper-plane doodle (this week — send the PDF). */
function PaperPlaneDoodle() {
  return (
    <svg
      viewBox="0 0 48 32"
      className="h-8 w-12 text-coral"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 16 L 42 5 L 30 28 L 22 20 Z" />
      <path d="M22 20 L 42 5" />
      <path d="M6 25 C 9 24, 12 24, 14 25 M4 29 C 8 28, 12 28, 16 29" />
    </svg>
  );
}

interface KeepsakeSectionProps {
  onCtaClick: () => void;
}

/**
 * The keepsake ladder — one story, three ways to keep it. Cream band with
 * scallop dividers top and bottom; the print card is the featured rung.
 * Print copy is gated by isPrintShippableLocale so locales without checkout
 * (ja today) never see an order they can't place. The print visual is the
 * honest day-one fallback: the real example cover inside a drawn book frame,
 * visibly artwork — swapped for real photography the day it exists.
 */
export function KeepsakeSection({ onCtaClick }: KeepsakeSectionProps) {
  const t = useTranslations('landing');
  const locale = useLocale();
  const printShippable = isPrintShippableLocale(locale);
  const coverUrl = getCoverUrl(EXAMPLE_BOOKS[0]);

  return (
    <section aria-labelledby="keepsake-title" className="relative">
      <ScallopEdge flip fill={BAND_FILL} className="relative z-10 block" />
      <div className="-mt-px bg-[#FDF1E3] px-4 py-16 md:py-24">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2
              id="keepsake-title"
              className="font-playful text-2xl font-bold text-ink sm:text-3xl md:text-4xl"
            >
              {t('keepsakeTitle')}
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-ink-soft">{t('keepsakeSub')}</p>
          </div>

          <div className="mt-10 grid items-stretch gap-6 text-left md:mt-14 md:grid-cols-3">
            {/* 1 — Tonight */}
            <div className="flex flex-col rounded-2xl border border-ink/10 bg-white p-6 shadow-sm">
              <FlipbookDoodle />
              <h3 className="mt-4 font-playful text-xl text-coral">{t('keepsakeCard1Label')}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft md:text-base">
                {t('keepsakeCard1Body')}
              </p>
            </div>

            {/* 2 — This week */}
            <div className="flex flex-col rounded-2xl border border-ink/10 bg-white p-6 shadow-sm">
              <PaperPlaneDoodle />
              <h3 className="mt-4 font-playful text-xl text-coral">{t('keepsakeCard2Label')}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft md:text-base">
                {t('keepsakeCard2Body')}
              </p>
            </div>

            {/* 3 — Whenever you're ready (featured: the keepsake) */}
            <div className="relative pt-3">
              <span className="absolute -top-0.5 left-1/2 z-20 -translate-x-1/2 -rotate-2 rounded-full bg-coral px-4 py-1 font-playful text-sm text-white shadow-sm">
                {t('keepsakeRibbon')}
              </span>
              <StorybookFrame
                className="h-full"
                borderColor="var(--coral-primary)"
                showPageCurl={false}
              >
                <div className="flex h-full flex-col p-4">
                  <h3 className="font-playful text-xl text-coral">{t('keepsakeCard3Label')}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft md:text-base">
                    {printShippable ? t('keepsakeCard3Body') : t('keepsakeCard3SoonBody')}
                  </p>
                  {/* Honest interim visual: real example cover in a drawn
                      frame, labelled with the trim size — artwork, never a
                      fake product photo. */}
                  <div className="mt-4 flex items-end justify-center gap-2">
                    <div className="relative w-28 -rotate-2 overflow-hidden rounded-md border-2 border-ink/15 shadow-md md:w-32">
                      <div className="relative aspect-square w-full bg-[var(--cream-yellow)]">
                        <Image
                          src={coverUrl}
                          alt={EXAMPLE_BOOKS[0].coverAlt}
                          fill
                          sizes="128px"
                          className="object-cover"
                        />
                      </div>
                    </div>
                    <span className="mb-1 font-playful text-xs text-ink-soft">
                      {t('keepsakeSizeLabel')}
                    </span>
                  </div>
                  <p className="mt-4 text-xs leading-relaxed text-ink-soft">
                    {t('keepsakeShipping')}
                  </p>
                </div>
              </StorybookFrame>
            </div>
          </div>

          <div className="mt-12">
            <LandingCta onClick={onCtaClick} />
          </div>
        </div>
      </div>
      <ScallopEdge fill={BAND_FILL} className="relative z-10 -mt-px block" />
    </section>
  );
}

export default KeepsakeSection;
