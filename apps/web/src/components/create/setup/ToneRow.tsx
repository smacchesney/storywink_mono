'use client';

import React from 'react';
import { useLocale } from 'next-intl';
import { STORY_MOODS, STORY_MOOD_LABELS, type StoryMood } from '@storywink/shared/constants';
import { cn } from '@/lib/utils';

interface ToneRowProps {
  tone: StoryMood | null;
  onToneChange: (tone: StoryMood | null) => void;
}

/** The tap-first mood chips — extracted from StoryFraming so the wizard's
 * step 2 and the flag-off sheet render the exact same row. */
export function ToneRow({ tone, onToneChange }: ToneRowProps) {
  const locale = useLocale() === 'ja' ? 'ja' : 'en';
  return (
    <div className="relative">
      <div className="flex snap-x gap-1.5 overflow-x-auto pr-6 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {STORY_MOODS.map((mood) => {
          const selected = tone === mood;
          return (
            <button
              key={mood}
              type="button"
              aria-pressed={selected}
              onClick={() => onToneChange(selected ? null : mood)}
              className={cn(
                'min-h-[44px] shrink-0 snap-start rounded-full border px-4 font-playful text-sm whitespace-nowrap transition-colors',
                selected
                  ? 'border-coral bg-coral text-white'
                  : 'border-black/10 bg-white text-gray-700 hover:border-coral/50',
              )}
            >
              {STORY_MOOD_LABELS[mood][locale]}
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}

export default ToneRow;
