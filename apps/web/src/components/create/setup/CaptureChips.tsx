"use client";

import React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export interface CaptureQuestion {
  id: string;
  question: string;
  options: string[];
  answer?: string | null;
}

interface CaptureChipsProps {
  questions: CaptureQuestion[];
  /** Fires with the full updated list whenever an answer changes. */
  onChange: (questions: CaptureQuestion[]) => void;
}

const SKIP = '__skip__';

/**
 * Renders the AI's photo-derived micro-questions as tappable option chips
 * (at most 3 rows), each with a "skip" affordance. Answering a chip PATCHes
 * the answer back through the parent. Nothing renders until questions arrive.
 */
export function CaptureChips({ questions, onChange }: CaptureChipsProps) {
  const t = useTranslations('setup');
  const rows = questions.slice(0, 3);

  const setAnswer = (id: string, answer: string | null) => {
    onChange(questions.map((q) => (q.id === id ? { ...q, answer } : q)));
  };

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {rows.map((q) => {
        const skipped = q.answer === SKIP;
        return (
          <div key={q.id} className="flex flex-col gap-1.5">
            <p className="text-sm text-gray-700">{q.question}</p>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map((opt) => {
                const active = q.answer === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setAnswer(q.id, active ? null : opt)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm font-playful transition-colors',
                      active
                        ? 'border-[#F76C5E] bg-[#F76C5E] text-white'
                        : 'border-black/10 bg-white text-gray-700 hover:border-[#F76C5E]/50'
                    )}
                  >
                    {opt}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setAnswer(q.id, skipped ? null : SKIP)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm font-playful transition-colors',
                  skipped
                    ? 'border-gray-300 bg-gray-200 text-gray-500'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                )}
              >
                {t('skip')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default CaptureChips;
