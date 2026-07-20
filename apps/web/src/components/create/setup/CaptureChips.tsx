'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
// RELATIVE (not `@/lib/discovery-client`): star-ask.test.ts and
// capture-chips.test.ts both import `./CaptureChips` under root vitest, which
// resolves no `@/` alias. discovery-client is a pure `process.env` constant
// module, so loading it for real in tests is side-effect-free.
import { CREATE_DISCOVERY_FLAG } from '../../../lib/discovery-client';

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

export interface QuestionCaps {
  naming: number;
  total: number;
}

interface CaptureChipsProps {
  questions: CaptureQuestion[];
  /** Raises the naming/total caps in ensemble mode; omit for the legacy shape. */
  caps?: QuestionCaps;
  /** Fires with the full updated list whenever an answer changes. */
  onChange: (questions: CaptureQuestion[]) => void;
}

const SKIP = '__skip__';

/** Naming questions render first. Default caps mirror the legacy shape
 * (2 naming / 3 total); ensemble mode raises them so every member's naming
 * chip fits. Non-naming `ramble_*` rows are extraction facts, not questions
 * for the parent — they persist and reach the story prompt but never render.
 * X17.2 (`dropNaming`, flag-on only): naming questions never render here —
 * the Who's-in-this-book face row owns every person/pet ask
 * (asked-exactly-once invariant). Only the companion-object question and
 * characterId-less "other" questions remain. Flag-off (default) keeps
 * today's list and ordering byte-identically. */
export function orderQuestions(
  questions: CaptureQuestion[],
  caps: QuestionCaps = { naming: 2, total: 3 },
  dropNaming = false,
): CaptureQuestion[] {
  const isNaming = (q: CaptureQuestion) =>
    (q.kind ?? (q.characterId ? 'naming' : 'other')) === 'naming';
  if (dropNaming) {
    const visible = questions.filter(
      (q) => !isNaming(q) && (q.characterId || !q.id.startsWith('ramble_')),
    );
    return visible.slice(0, caps.total);
  }
  const visible = questions.filter((q) => q.characterId || !q.id.startsWith('ramble_'));
  const naming = visible.filter((q) => q.characterId);
  const other = visible.filter((q) => !q.characterId);
  return [...naming.slice(0, caps.naming), ...other, ...naming.slice(caps.naming)].slice(
    0,
    caps.total,
  );
}

/**
 * Renders the AI's photo-derived micro-questions as tappable option chips
 * (at most 3 rows), each with a "skip" affordance. Naming questions sort
 * first and add a "Someone else…" chip that expands into a one-line text
 * input (commit on blur/enter). Answering PATCHes back through the parent.
 * Nothing renders until questions arrive.
 */
export function CaptureChips({ questions, caps, onChange }: CaptureChipsProps) {
  const t = useTranslations('setup');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  // Flag read in the COMPONENT, never in the pure function — flag-on drops the
  // naming rows the face row now owns.
  const rows = orderQuestions(questions, caps, CREATE_DISCOVERY_FLAG);

  const setAnswer = (id: string, answer: string | null) => {
    onChange(questions.map((q) => (q.id === id ? { ...q, answer } : q)));
  };

  // A typed name: answered, not skipped, and not one of the tappable options.
  const customAnswer = (q: CaptureQuestion): string | null =>
    q.answer && q.answer !== SKIP && !q.options.includes(q.answer) ? q.answer : null;

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
                      'rounded-full border px-3 py-1 font-playful text-sm transition-colors',
                      active
                        ? 'border-coral bg-coral text-white'
                        : 'border-black/10 bg-white text-gray-700 hover:border-coral/50',
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
                    className="h-[30px] w-36 rounded-full border border-coral bg-white px-3 font-playful text-sm text-gray-800 focus:ring-1 focus:ring-coral focus:outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingId(q.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 font-playful text-sm transition-colors',
                      typed
                        ? 'border-coral bg-coral text-white'
                        : 'border-dashed border-black/20 bg-white text-gray-500 hover:border-coral/50 hover:text-gray-700',
                    )}
                  >
                    {typed ?? t(isObject ? 'itsCalled' : 'someoneElse')}
                  </button>
                ))}
              <button
                type="button"
                onClick={() => setAnswer(q.id, skipped ? null : SKIP)}
                className={cn(
                  'rounded-full border px-3 py-1 font-playful text-sm transition-colors',
                  skipped
                    ? 'border-gray-300 bg-gray-200 text-gray-500'
                    : 'border-transparent text-gray-400 hover:text-gray-600',
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
