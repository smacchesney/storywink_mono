'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { Storydust } from '@/components/ui/storydust';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { StyleKey } from '@storywink/shared/prompts/styles';
import type { StoryMood } from '@storywink/shared/constants';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { track } from '@/lib/track';
import PhotoStrip, { StripPhoto } from '@/components/create/setup/PhotoStrip';
import ArtStyleStrip from '@/components/create/setup/ArtStyleStrip';
import LibrarianStrip from '@/components/create/setup/LibrarianStrip';
import StoryFraming from '@/components/create/setup/StoryFraming';
import type { StripPhase } from '@/components/create/setup/strip-phase';
import AvatarMatchChip from '@/components/create/setup/AvatarMatchChip';
import CaptureChips, {
  CaptureQuestion,
} from '@/components/create/setup/CaptureChips';

export interface SetupFormState {
  childName: string;
  title: string;
  eventSummary: string;
  captureQuestions: CaptureQuestion[];
  artStyle: StyleKey;
  tone: StoryMood | null;
  learningWords: string[];
  reviewFirst: boolean;
}

interface SetupSheetProps {
  photos: StripPhoto[];
  form: SetupFormState;
  /**
   * Child name the server prefilled from the parent's most recent book.
   * While the field still holds it, a one-line "for {name} again!" shows
   * under the input; any edit makes the line step aside.
   */
  prefilledName?: string | null;
  /** True until perception fills the title — drives the shimmer. */
  titlePending: boolean;
  /** Librarian-strip phase — 'hidden' keeps the strip unmounted. */
  stripPhase: StripPhase;
  /** True once the parent edited the summary (telemetry only). */
  summaryEdited: boolean;
  isSubmitting: boolean;
  showNameError: boolean;
  /** Book id — enables the inline add/remove affordances in the photo strip. */
  bookId?: string;
  /** Perception roster id of this book's star, for the avatar confirm row. */
  mainCharacterId?: string | null;
  onReorder: (photos: StripPhoto[]) => void;
  /** Refetch trigger after photos are added/removed inline. */
  onPhotosChanged?: () => void | Promise<void>;
  onChange: <K extends keyof SetupFormState>(
    key: K,
    value: SetupFormState[K],
  ) => void;
  onSubmit: () => void;
}

/**
 * The single pre-generation surface. Top to bottom: photo strip (cover =
 * first), the one required field (child name), an AI-prefilled title, the
 * "what we see" experience brief, capture chips, an art-style strip, a
 * quiet review toggle, and the coral "Make my book" button.
 */
export function SetupSheet({
  photos,
  form,
  prefilledName,
  titlePending,
  stripPhase,
  summaryEdited,
  isSubmitting,
  showNameError,
  bookId,
  mainCharacterId,
  onReorder,
  onPhotosChanged,
  onChange,
  onSubmit,
}: SetupSheetProps) {
  const t = useTranslations('setup');
  const reducedMotion = useReducedMotion() ?? false;

  const hasChips = form.captureQuestions.length > 0;
  // Reserved chips space while the librarian is still reading — arrival then
  // animates INSIDE this box, so nothing below it ever shifts. Collapses
  // gently (transition on min-height) when reading ends with zero questions.
  const reserveChipSpace = stripPhase === 'reading' && !hasChips;

  const handleSubmitClick = () => {
    // Funnel telemetry — fire only for taps that pass the one required field,
    // matching what actually submits (fire-and-forget, never blocks).
    if (form.childName.trim()) {
      track('setup_submitted', {
        ...(bookId ? { bookId } : {}),
        props: {
          reviewFirst: form.reviewFirst,
          chipsAnswered: form.captureQuestions.filter(
            (q) => q.answer && q.answer !== '__skip__',
          ).length,
          ...(form.tone ? { tone: form.tone } : {}),
          stripPhaseAtSubmit: stripPhase,
          summaryEdited,
        },
      });
    }
    onSubmit();
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 pb-28 pt-4">
      {/* Photos */}
      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-600">
          {t('photosLabel')}
        </label>
        <PhotoStrip
          photos={photos}
          onReorder={onReorder}
          bookId={bookId}
          onPhotosChanged={onPhotosChanged}
        />
      </section>

      {/* Librarian strip — narrates the perception pass; never mounts when
          nothing is plausibly in flight, never collapses once mounted. */}
      {stripPhase !== 'hidden' && (
        <LibrarianStrip
          phase={stripPhase}
          questionCount={form.captureQuestions.length}
        />
      )}

      {/* Child name — the one required field */}
      <section className="flex flex-col gap-1.5">
        <label
          htmlFor="childName"
          className="text-sm font-medium text-gray-600"
        >
          {t('childNameLabel')}
        </label>
        <Input
          id="childName"
          value={form.childName}
          onChange={(e) => onChange('childName', e.target.value)}
          placeholder={t('childNamePlaceholder')}
          maxLength={50}
          className={cn(
            'font-playful text-base',
            showNameError && 'border-coral focus-visible:ring-coral',
          )}
        />
        {showNameError && (
          <p className="text-xs text-coral">{t('childNameRequired')}</p>
        )}
        {!showNameError &&
          prefilledName &&
          form.childName === prefilledName && (
            <p className="text-xs text-gray-500">
              <Sparkles className="mr-1 inline h-3 w-3 text-coral" />
              {t('childNameAgain', { name: prefilledName })}
            </p>
          )}
      </section>

      {/* Title — AI-prefilled with a thinking shimmer */}
      <section className="flex flex-col gap-1.5">
        <label htmlFor="title" className="text-sm font-medium text-gray-600">
          {t('titleLabel')}
        </label>
        <div className="relative">
          <Input
            id="title"
            value={form.title}
            onChange={(e) => onChange('title', e.target.value)}
            placeholder={titlePending ? '' : t('titlePlaceholder')}
            maxLength={100}
            className="font-playful text-base"
          />
          {titlePending && !form.title && (
            <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center gap-2 text-gray-400">
              <Storydust variant="twinkle" size="inline" />
              <span className="font-playful text-sm">
                {t('titleThinking')}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Story framing — always renders: the mood row needs zero analysis,
          and a missing summary falls back to a quiet "add a note" button. */}
      <StoryFraming
        tone={form.tone}
        eventSummary={form.eventSummary}
        learningWords={form.learningWords}
        onToneChange={(v) => onChange('tone', v)}
        onSummaryChange={(v) => onChange('eventSummary', v)}
        onLearningWordsChange={(v) => onChange('learningWords', v)}
      />

      {/* Capture chips — space is reserved while the librarian reads, and the
          rows rise into that same box on arrival (no layout shift below).
          When reading ends with zero questions the box collapses gently. */}
      <AnimatePresence initial={false}>
        {(reserveChipSpace || hasChips) && (
          <motion.section
            exit={{ height: 0, opacity: 0, marginTop: -24 }}
            transition={{
              duration: reducedMotion ? 0 : 0.2,
              ease: 'easeOut',
            }}
            className="overflow-hidden"
            style={{ minHeight: reserveChipSpace ? 96 : undefined }}
          >
            {hasChips && (
              <div className={stripPhase === 'hidden' ? undefined : 'chips-enter'}>
                {bookId && mainCharacterId && (
                  <AvatarMatchChip bookId={bookId} mainCharacterId={mainCharacterId} />
                )}
                <CaptureChips
                  questions={form.captureQuestions}
                  onChange={(qs) => onChange('captureQuestions', qs)}
                />
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
      <style jsx global>{`
        .chips-enter > div > div {
          animation: chip-rise 300ms ease-out both;
        }
        .chips-enter > div > div:nth-child(2) {
          animation-delay: 60ms;
        }
        .chips-enter > div > div:nth-child(3) {
          animation-delay: 120ms;
        }
        @keyframes chip-rise {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .chips-enter > div > div {
            animation-name: chip-fade;
            animation-delay: 0ms;
          }
          @keyframes chip-fade {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
        }
      `}</style>

      {/* Art style */}
      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-600">
          {t('artStyleLabel')}
        </label>
        <ArtStyleStrip
          value={form.artStyle}
          onChange={(s) => onChange('artStyle', s)}
        />
      </section>

      {/* Review-first toggle — quiet / tertiary */}
      <section className="flex items-center justify-between">
        <label htmlFor="reviewFirst" className="text-sm text-gray-500">
          {t('reviewFirstLabel')}
        </label>
        <Switch
          id="reviewFirst"
          checked={form.reviewFirst}
          onCheckedChange={(v) => onChange('reviewFirst', v)}
        />
      </section>

      {/* Primary CTA — fixed to the bottom on mobile */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-black/5 bg-white/90 px-4 py-3 backdrop-blur">
        <button
          onClick={handleSubmitClick}
          disabled={isSubmitting}
          className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-full bg-coral px-6 py-3.5 font-playful text-lg text-white shadow-md transition-colors hover:bg-coral/90 disabled:opacity-70"
        >
          {isSubmitting ? (
            <>
              <Storydust variant="twinkle" size="inline" className="text-white" />
              {t('saving')}
            </>
          ) : (
            t('makeMyBook')
          )}
        </button>
      </div>
    </div>
  );
}

export default SetupSheet;
