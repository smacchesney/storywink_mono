'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/track';
import { cn } from '@/lib/utils';

interface WhatNowCardProps {
  bookId: string;
  /** Slides up when the reader reaches the back cover; slides away when they flip back. */
  visible: boolean;
  /**
   * Whether we can actually ship a printed copy to this reader's market.
   * Where we can't (ja today), print never appears as a dead-end CTA — the
   * PDF takes the lead and print interest is captured honestly instead.
   */
  printShippable: boolean;
  onReadAgain: () => void;
  onOrderPrint: () => void;
  onSavePdf: () => void;
  onDismiss: () => void;
}

/**
 * The "what now" beat at the end of the book — anchored low so the waving
 * cats on the back cover keep waving above it. Two visible actions plus a
 * quiet third; dismissible, and it never comes back once dismissed.
 */
export function WhatNowCard({
  bookId,
  visible,
  printShippable,
  onReadAgain,
  onOrderPrint,
  onSavePdf,
  onDismiss,
}: WhatNowCardProps) {
  const t = useTranslations('whatNow');
  const locale = useLocale();
  const [interestSent, setInterestSent] = useState(false);

  // Demand per market is measurable: one view event per read-through.
  const viewTrackedRef = useRef(false);
  useEffect(() => {
    if (!visible || viewTrackedRef.current) return;
    viewTrackedRef.current = true;
    track('print_cta_view', { bookId, props: { locale, printShippable } });
  }, [visible, bookId, locale, printShippable]);

  const handleOrderPrint = () => {
    track('print_cta_click', { bookId, props: { locale } });
    onOrderPrint();
  };

  const handlePrintInterest = () => {
    if (interestSent) return;
    setInterestSent(true);
    track('print_interest', { bookId, props: { locale } });
  };

  return (
    <div
      aria-hidden={!visible}
      // Keep the slide transition (element stays mounted) without leaving
      // invisible buttons in the tab order.
      inert={!visible || undefined}
      className={cn(
        'absolute bottom-3 left-1/2 z-20 w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2',
        'transition-all duration-300 ease-out motion-reduce:transition-none',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0',
      )}
    >
      <div className="relative rounded-2xl border border-coral/20 bg-white/95 px-4 pt-5 pb-4 shadow-lg backdrop-blur-sm">
        <button
          onClick={onDismiss}
          aria-label={t('dismiss')}
          className="absolute top-2 right-2 rounded-full p-1 text-gray-400 hover:bg-muted hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onReadAgain}
            className="flex-1 rounded-full border-coral/40 font-playful text-coral hover:bg-coral/5 hover:text-coral"
          >
            {t('readAgain')}
          </Button>
          {printShippable ? (
            <Button
              onClick={handleOrderPrint}
              className="flex-1 rounded-full bg-coral font-playful text-white hover:bg-coral/90"
            >
              {t('orderPrint')}
            </Button>
          ) : (
            <Button
              onClick={onSavePdf}
              className="flex-1 rounded-full bg-coral font-playful text-white hover:bg-coral/90"
            >
              {t('savePdf')}
            </Button>
          )}
        </div>

        {printShippable ? (
          <button
            onClick={onSavePdf}
            className="mt-3 w-full text-center font-playful text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700"
          >
            {t('savePdf')}
          </button>
        ) : (
          <button
            onClick={handlePrintInterest}
            disabled={interestSent}
            className={cn(
              'mt-3 w-full text-center font-playful text-xs',
              interestSent
                ? 'text-coral'
                : 'text-gray-500 underline underline-offset-2 hover:text-gray-700',
            )}
          >
            {interestSent ? t('printThanks') : t('printSoon')}
          </button>
        )}
      </div>
    </div>
  );
}

export default WhatNowCard;
