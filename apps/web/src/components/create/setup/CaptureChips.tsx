"use client";

import React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export interface CaptureQuestion {
  id: string;
  question: string;
  options: string[];
  /** Set on naming questions — links the question to a roster character. */
  characterId?: string | null;
  /** 'object' renders free-text-first; absent on older stored questions. */
  kind?: 'naming' | 'object' | 'other';
  answer?: string | null;
}

interface CaptureChipsProps {
  questions: CaptureQuestion[];
  /** Fires with the full updated list whenever an answer changes. */
  onChange: (questions: CaptureQuestion[]) => void;
}

const SKIP = '__skip__';

/** Naming questions render first, capped at 2 of the 3 rows so a
 * highlight/firsts question usually survives (mirrors the worker-side cap). */
function orderQuestions(questions: CaptureQuestion[]): CaptureQuestion[] {
  const naming = questions.filter((q) => q.characterId);
  const other = questions.filter((q) => !q.characterId);
  return [...naming.slice(0, 2), ...other, ...naming.slice(2)].slice(0, 3);
}

/**
 * Renders the AI's photo-derived micro-questions as tappable option chips
 * (at most 3 rows), each with a "skip" affordance. Naming questions sort
 * first and add a "Someone else…" chip that expands into a one-line text
 * input (commit on blur/enter). Answering PATCHes back through the parent.
 * Nothing renders until questions arrive.
 */
export function CaptureChips({ questions, onChange }: CaptureChipsProps) {
  const t = useTranslations('setup');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const rows = orderQuestions(questions);

  const setAnswer = (id: string, answer: string | null) => {
    onChange(questions.map((q) => (q.id === id ? { ...q, answer } : q)));
  };

  // A typed name: answered, not skipped, and not one of the tappable options.
  const customAnswer = (q: CaptureQuestion): string | null =>
    q.answer && q.answer !== SKIP && !q.options.includes(q.answer)
      ? q.answer
      : null;

  const commitCustom = (q: CaptureQuestion, raw: string) => {
    setEditingId(null);
    const value = raw.trim().slice(0, 50);
    if (value) setAnswer(q.id, value);
    // Emptying a previously-typed name deselects it. Gated on customAnswer so
    // abandoning an empty "Someone else…" input while an option chip (e.g.
    // "Grandma") is selected leaves that selection intact.
    else if (customAnswer(q)) setAnswer(q.id, null);
  };

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {rows.map((q) => {
        const skipped = q.answer === SKIP;
        const typed = customAnswer(q);
        // Object questions ("does the bunny have a name?") are free-text-first:
        // they arrive with empty options, so the type-a-name affordance IS the answer.
        const isObject = (q.kind ?? (q.characterId ? 'naming' : 'other')) === 'object';
        return (
          <div key={q.id} className="flex flex-col gap-1.5">
            <p className="text-sm text-gray-700">{q.question}</p>
            <div className="flex flex-wrap items-center gap-1.5">
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
                        ? 'border-coral bg-coral text-white'
                        : 'border-black/10 bg-white text-gray-700 hover:border-coral/50'
                    )}
                  >
                    {opt}
                  </button>
                );
              })}
              {/* Free-text affordance: "Someone else…" on naming questions,
                  "It has a name…" on object questions. */}
              {(q.characterId || isObject) &&
                (editingId === q.id ? (
                  <input
                    autoFocus
                    type="text"
                    defaultValue={typed ?? ''}
                    maxLength={50}
                    placeholder={t(isObject ? 'objectNamePlaceholder' : 'someoneElsePlaceholder')}
                    onBlur={(e) => commitCustom(q, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    className="h-[30px] w-36 rounded-full border border-coral bg-white px-3 text-sm font-playful text-gray-800 focus:outline-none focus:ring-1 focus:ring-coral"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingId(q.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm font-playful transition-colors',
                      typed
                        ? 'border-coral bg-coral text-white'
                        : 'border-dashed border-black/20 bg-white text-gray-500 hover:border-coral/50 hover:text-gray-700'
                    )}
                  >
                    {typed ?? t(isObject ? 'itsCalled' : 'someoneElse')}
                  </button>
                ))}
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
