'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';
import type { StoryMood } from '@storywink/shared/constants';
import LearningWords from '@/components/create/setup/LearningWords';
import RambleTextarea from '@/components/create/setup/RambleTextarea';
import ToneRow from '@/components/create/setup/ToneRow';

interface StoryFramingProps {
  tone: StoryMood | null;
  eventSummary: string;
  /** Words the child is loving right now (max 4) — woven into the story. */
  learningWords: string[];
  onToneChange: (tone: StoryMood | null) => void;
  onSummaryChange: (summary: string) => void;
  onLearningWordsChange: (words: string[]) => void;
  /** X17 B4: render the ramble field instead of the truncated summary row. */
  ramble?: boolean;
  onRambleBlur?: () => void;
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
  ramble,
  onRambleBlur,
}: StoryFramingProps) {
  const t = useTranslations('setup');
  const locale = useLocale() === 'ja' ? 'ja' : 'en';
  const playful = locale === 'ja' ? 'font-japanese' : 'font-playful';
  // Once the parent opens the textarea it stays open for the session — the
  // second tap into it is what opts into the keyboard (never autofocused).
  const [expanded, setExpanded] = React.useState(false);

  const hasSummary = eventSummary.trim().length > 0;

  return (
    <section className="flex flex-col gap-2">
      <label className="text-sm font-medium text-gray-600">{t('howToTellIt')}</label>

      {/* Mood row — horizontal scroll-snap, right-edge fade hints the rest. */}
      <ToneRow tone={tone} onToneChange={onToneChange} />

      {/* Summary row — parent-editable AI text behind an explicit affordance.
          Same co-creation nudge as the avatar spark: a child-voiced placeholder
          and a Geist hint that invites talking (dictation) or typing.
          Under the ramble flag the truncated line becomes an always-visible
          dictation-first field; the legacy branches below stay untouched. */}
      {ramble ? (
        <div className="flex flex-col gap-1.5">
          <p className={`${playful} text-sm text-gray-600`}>{t('rambleLabel')}</p>
          <RambleTextarea
            value={eventSummary}
            onChange={onSummaryChange}
            onBlur={onRambleBlur}
            placeholder={t('eventSummaryPlaceholder')}
            hint={t('eventSummaryHint')}
          />
        </div>
      ) : expanded ? (
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
      <LearningWords words={learningWords} onChange={onLearningWordsChange} />
    </section>
  );
}

export default StoryFraming;
