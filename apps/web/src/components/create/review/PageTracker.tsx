import React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageTrackerProps {
  totalPages: number;
  currentPage: number;
  confirmed: boolean[];
  onPageSelect: (index: number) => void;
  allPagesConfirmed: boolean;
  isProcessing: boolean;
  onIllustrate: () => void;
}

/**
 * PageTracker provides a visual indicator for page navigation and completion status
 * Shows dots for all pages, with color-coding for confirmation status
 */
const PageTracker = ({
  totalPages,
  currentPage,
  confirmed,
  onPageSelect,
  allPagesConfirmed,
  isProcessing,
  onIllustrate,
}: PageTrackerProps) => {
  const t = useTranslations('review');
  return (
    <div className="page-tracker sticky top-0 z-10 border-b bg-white px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        {/* Dots container moved to the left side of the header */}
        <div className="dots-container no-scrollbar flex gap-1 overflow-x-auto py-1">
          {Array.from({ length: totalPages }).map((_, idx) => {
            const isConfirmed = confirmed[idx] ?? false;
            const isCurrent = idx === currentPage;

            return (
              <div key={idx} className="group relative">
                <button
                  onClick={() => onPageSelect(idx)}
                  className={`h-2 transition-all duration-200 ${isCurrent ? 'w-6' : 'w-2'} rounded-full ${isCurrent ? 'scale-y-150' : ''} ${isConfirmed ? 'bg-green-500' : 'bg-gray-300'} `}
                  aria-label={t('goToPage', { n: idx + 1 })}
                />

                {/* Hoverable tooltip */}
                <div className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 transform rounded bg-gray-800 px-2 py-1 text-xs whitespace-nowrap text-white opacity-0 transition-opacity group-hover:opacity-100">
                  {t('page', { n: idx + 1 })}
                  {isConfirmed && ' ✓'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Illustrate button - always visible but conditionally styled/disabled */}
        <Button
          onClick={onIllustrate}
          disabled={!allPagesConfirmed || isProcessing}
          size="sm"
          className={cn(
            'ml-2 whitespace-nowrap transition-colors duration-200',
            allPagesConfirmed && !isProcessing
              ? 'bg-coral text-white hover:bg-coral/90'
              : 'cursor-not-allowed bg-gray-400 text-white hover:bg-gray-400',
          )}
        >
          {isProcessing ? (
            <>{t('working')}</>
          ) : (
            <>
              <CheckCircle className="mr-1 h-4 w-4" />
              {t('illustrateBook')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

export default PageTracker;
