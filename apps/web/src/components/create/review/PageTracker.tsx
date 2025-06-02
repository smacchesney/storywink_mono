import React from 'react';
import { Button } from '@/components/ui/button';
import { BookOpen, CheckCircle, SparklesIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageTrackerProps {
  totalPages: number;
  currentPage: number;
  confirmedPages: number;
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
  confirmedPages, 
  onPageSelect,
  allPagesConfirmed,
  isProcessing,
  onIllustrate
}: PageTrackerProps) => {
  return (
    <div className="page-tracker py-2 px-3 border-b bg-white sticky top-0 z-10">
      <div className="flex items-center justify-between mb-1">
        {/* Dots container moved to the left side of the header */}
        <div className="dots-container flex gap-1 overflow-x-auto py-1 no-scrollbar">
          {Array.from({ length: totalPages }).map((_, idx) => {
            const isConfirmed = idx < confirmedPages;
            const isCurrent = idx === currentPage;
            const isTitle = idx === 0;
            
            return (
              <div key={idx} className="group relative">
                <button 
                  onClick={() => onPageSelect(idx)}
                  className={`
                    h-2 transition-all duration-200
                    ${isCurrent ? 'w-6' : 'w-2'} 
                    rounded-full
                    ${isCurrent ? 'scale-y-150' : ''}
                    ${isConfirmed ? 'bg-green-500' : 'bg-gray-300'}
                  `}
                  aria-label={`Go to page ${idx + 1}`}
                />
                
                {/* Hoverable tooltip */}
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
                  {isTitle ? 'Title Page' : `Page ${idx}`}
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
            "ml-2 transition-colors duration-200 whitespace-nowrap",
            allPagesConfirmed && !isProcessing
              ? "bg-[#F76C5E] text-white hover:bg-[#F76C5E]/90"
              : "bg-gray-400 text-white cursor-not-allowed hover:bg-gray-400"
          )}
        >
          {isProcessing ? (
            <>Working...</>
          ) : (
            <>
              <CheckCircle className="h-4 w-4 mr-1" /> 
              Illustrate Book
            </>
          )}
        </Button>
      </div>
    </div>
  );
};

export default PageTracker; 