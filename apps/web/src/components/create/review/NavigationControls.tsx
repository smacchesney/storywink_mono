import React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface NavigationControlsProps {
  currentPage: number;
  totalPages: number;
  canGoNext: boolean;
  canGoPrevious: boolean;
  isProcessing: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/**
 * NavigationControls provides the sticky footer navigation between pages
 */
const NavigationControls = ({
  currentPage,
  totalPages,
  canGoNext,
  canGoPrevious,
  isProcessing,
  onPrevious,
  onNext,
}: NavigationControlsProps) => {
  const t = useTranslations('review');
  return (
    <div className="navigation-controls sticky bottom-0 z-10 flex items-center justify-between border-t bg-white p-3 shadow-md">
      <Button
        variant="outline"
        onClick={onPrevious}
        disabled={!canGoPrevious || isProcessing}
        size="sm"
        className="max-w-[120px] flex-1 border-coral text-coral hover:bg-coral hover:text-white"
      >
        <ChevronLeft className="mr-1 h-4 w-4" /> {t('previous')}
      </Button>

      <span className="mx-2 text-sm text-gray-500">
        {t('pageCounter', { current: currentPage + 1, total: totalPages })}
      </span>

      <Button
        variant="outline"
        onClick={onNext}
        disabled={!canGoNext || isProcessing}
        size="sm"
        className="max-w-[120px] flex-1 border-coral text-coral hover:bg-coral hover:text-white"
      >
        {t('next')} <ChevronRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  );
};

export default NavigationControls;
