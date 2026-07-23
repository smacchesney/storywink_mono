'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

interface LearningWordsProps {
  words: string[];
  onChange: (words: string[]) => void;
}

/** "Any words they're loving right now?" — extracted from StoryFraming;
 * rendered by the flag-off sheet and, flag-on, inside step 4's More options. */
export function LearningWords({ words, onChange }: LearningWordsProps) {
  const t = useTranslations('setup');
  const [wordsExpanded, setWordsExpanded] = React.useState(false);

  const commitWord = (raw: string, input: HTMLInputElement) => {
    const word = raw.trim().slice(0, 30);
    input.value = '';
    if (!word || words.includes(word) || words.length >= 4) return;
    onChange([...words, word]);
  };

  return wordsExpanded || words.length > 0 ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {words.map((word) => (
        <button
          key={word}
          type="button"
          aria-label={t('learningWordRemove', { word })}
          onClick={() => onChange(words.filter((w) => w !== word))}
          className="rounded-full border border-coral bg-coral px-3 py-1 font-playful text-sm text-white"
        >
          {word} ×
        </button>
      ))}
      {words.length < 4 && (
        <input
          type="text"
          maxLength={30}
          placeholder={t('learningWordsPlaceholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitWord(e.currentTarget.value, e.currentTarget);
            }
          }}
          onBlur={(e) => commitWord(e.currentTarget.value, e.currentTarget)}
          className="h-[30px] w-40 rounded-full border border-black/10 bg-white px-3 font-playful text-sm text-gray-800 focus:border-coral focus:ring-1 focus:ring-coral focus:outline-none"
        />
      )}
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setWordsExpanded(true)}
      className="min-h-[44px] self-start px-1 text-left font-playful text-sm text-gray-500 underline decoration-black/20 decoration-dashed underline-offset-4 transition-colors hover:text-gray-700"
    >
      {t('learningWordsAdd')}
    </button>
  );
}

export default LearningWords;
