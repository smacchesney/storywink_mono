'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowRight, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CharacterConfirmFooterProps {
  selectedCount: number;
  hasUnnamedCharacters: boolean;
  isSubmitting: boolean;
  onSkip: () => void;
  onContinue: () => void;
}

export function CharacterConfirmFooter({
  selectedCount,
  hasUnnamedCharacters,
  isSubmitting,
  onSkip,
  onContinue,
}: CharacterConfirmFooterProps) {
  const canContinue = selectedCount > 0 && !hasUnnamedCharacters;

  return (
    <div className="fixed bottom-0 inset-x-0 bg-white border-t shadow-lg">
      {/* iOS safe area padding */}
      <div className="px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {/* Helper text */}
        {selectedCount > 0 && hasUnnamedCharacters && (
          <p className="text-center text-sm text-amber-600 mb-2">
            Please enter names for all selected characters
          </p>
        )}

        {/* Buttons container */}
        <div className="flex gap-3 max-w-lg mx-auto">
          {/* Skip Button */}
          <Button
            variant="outline"
            onClick={onSkip}
            disabled={isSubmitting}
            className={cn(
              'flex-1 h-12 text-gray-600 border-gray-300',
              'hover:bg-gray-50 hover:text-gray-800',
              'transition-colors'
            )}
          >
            <SkipForward className="w-4 h-4 mr-2" />
            Skip
          </Button>

          {/* Continue Button */}
          <Button
            onClick={onContinue}
            disabled={!canContinue || isSubmitting}
            className={cn(
              'flex-1 h-12 font-semibold',
              'bg-[#F76C5E] hover:bg-[#E55C4E]',
              'text-white',
              'transition-colors',
              !canContinue && 'opacity-50 cursor-not-allowed'
            )}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>

        {/* Selection info */}
        <p className="text-center text-xs text-gray-500 mt-2">
          {selectedCount === 0
            ? 'Tap faces to select the main characters'
            : `${selectedCount} character${selectedCount > 1 ? 's' : ''} selected`}
        </p>
      </div>
    </div>
  );
}

export default CharacterConfirmFooter;
