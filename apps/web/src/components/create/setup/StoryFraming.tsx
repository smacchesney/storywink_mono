'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';
import { STORY_MOODS, STORY_MOOD_LABELS, type StoryMood } from '@storywink/shared/constants';
import { cn } from '@/lib/utils';

interface StoryFramingProps {
  tone: StoryMood | null;
  eventSummary: string;
  /** Words the child is loving right now (max 4) — woven into the story. */
  learningWords: string[];
  onToneChange: (tone: StoryMood | null) => void;
  onSummaryChange: (summary: string) => void;
  onLearningWordsChange: (words: string[]) => void;
}

/**
 * "How should we tell it?" — the parent's framing controls. A tap-first mood
 * row (single-select chips) plus the AI's story summary demoted to a
 * tap-to-edit line. Needs zero analysis to be useful: the mood row is static
 * content, and a missing summary falls back to a quiet "add a note" button,
 * so a failed perception pass still leaves the parent full framing power.
 */
export function StoryFraming({
  tone,
  eventSummary,
  learningWords,
  onToneChange,
  onSummaryChange,
  onLearningWordsChange,
}: StoryFramingProps) {
  const t = useTranslations('setup');
  const locale = useLocale() === 'ja' ? 'ja' : 'en';
  // Once the parent opens the textarea it stays open for the session — the
  // second tap into it is what opts into the keyboard (never autofocused).
  const [expanded, setExpanded] = React.useState(false);
  const [wordsExpanded, setWordsExpanded] = React.useState(false);

  const commitWord = (raw: string, input: HTMLInputElement) => {
    const word = raw.trim().slice(0, 30);
    input.value = '';
    if (!word || learningWords.includes(word) || learningWords.length >= 4) return;
    onLearningWordsChange([...learningWords, word]);
  };

  const hasSummary = eventSummary.trim().length > 0;

  return (
    <section className="flex flex-col gap-2">
      <label className="text-sm font-medium text-gray-600">{t('howToTellIt')}</label>

      {/* Mood row — horizontal scroll-snap, right-edge fade hints the rest. */}
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

      {/* Summary row — parent-editable AI text behind an explicit affordance.
          Same co-creation nudge as the avatar spark: a child-voiced placeholder
          and a Geist hint that invites talking (dictation) or typing. */}
      {expanded ? (
        <div className="flex flex-col gap-1.5">
          <textarea
            id="eventSummary"
            value={eventSummary}
            onChange={(e) => onSummaryChange(e.target.value)}
            placeholder={t('eventSummaryPlaceholder')}
            rows={3}
            maxLength={500}
            className="w-full resize-none rounded-xl border border-black/10 bg-white px-3 py-2 font-playful text-sm text-gray-800 focus:border-coral focus:ring-1 focus:ring-coral focus:outline-none"
          />
          <p className="px-1 text-xs text-gray-500">{t('eventSummaryHint')}</p>
        </div>
      ) : hasSummary ? (
        <button
          type="button"
          aria-label={t('editSummary')}
          onClick={() => setExpanded(true)}
          className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-1 text-left"
        >
          <span className="min-w-0 flex-1 truncate font-playful text-sm text-gray-500">
            {eventSummary}
          </span>
          <Pencil className="h-4 w-4 shrink-0 text-gray-400" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="min-h-[44px] self-start px-1 text-left font-playful text-sm text-gray-500 underline decoration-black/20 decoration-dashed underline-offset-4 transition-colors hover:text-gray-700"
        >
          {t('addNote')}
        </button>
      )}

      {/* Learning words — curiosity, never curriculum. Collapsed to one quiet
          line; expanding shows removable word chips plus a small input. */}
      {wordsExpanded || learningWords.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {learningWords.map((word) => (
            <button
              key={word}
              type="button"
              aria-label={t('learningWordRemove', { word })}
              onClick={() => onLearningWordsChange(learningWords.filter((w) => w !== word))}
              className="rounded-full border border-coral bg-coral px-3 py-1 font-playful text-sm text-white"
            >
              {word} ×
            </button>
          ))}
          {learningWords.length < 4 && (
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
      )}
    </section>
  );
}

export default StoryFraming;
