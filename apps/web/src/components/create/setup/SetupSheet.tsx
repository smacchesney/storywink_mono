'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Sparkles } from 'lucide-react';
import type { StyleKey } from '@storywink/shared/prompts/styles';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { track } from '@/lib/track';
import PhotoStrip, { StripPhoto } from '@/components/create/setup/PhotoStrip';
import ArtStyleStrip from '@/components/create/setup/ArtStyleStrip';
import CaptureChips, {
  CaptureQuestion,
} from '@/components/create/setup/CaptureChips';

export interface SetupFormState {
  childName: string;
  title: string;
  eventSummary: string;
  captureQuestions: CaptureQuestion[];
  artStyle: StyleKey;
  reviewFirst: boolean;
}

interface SetupSheetProps {
  photos: StripPhoto[];
  form: SetupFormState;
  /** True until perception fills the title — drives the shimmer. */
  titlePending: boolean;
  /** True once eventSummary has arrived from perception. */
  hasEventSummary: boolean;
  isSubmitting: boolean;
  showNameError: boolean;
  /** Book id — enables the inline add/remove affordances in the photo strip. */
  bookId?: string;
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
  titlePending,
  hasEventSummary,
  isSubmitting,
  showNameError,
  bookId,
  onReorder,
  onPhotosChanged,
  onChange,
  onSubmit,
}: SetupSheetProps) {
  const t = useTranslations('setup');

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
              <Sparkles className="h-3.5 w-3.5 animate-pulse text-coral" />
              <span className="animate-pulse font-playful text-sm">
                {t('titleThinking')}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Story brief — the experience-capture centerpiece */}
      {hasEventSummary && (
        <section className="flex flex-col gap-1.5">
          <label
            htmlFor="eventSummary"
            className="text-sm font-medium text-gray-600"
          >
            {t('whatWeSee')}
          </label>
          <textarea
            id="eventSummary"
            value={form.eventSummary}
            onChange={(e) => onChange('eventSummary', e.target.value)}
            placeholder={t('eventSummaryPlaceholder')}
            rows={2}
            className="w-full resize-none rounded-xl border border-black/10 bg-white px-3 py-2 font-playful text-sm text-gray-800 focus:border-coral focus:outline-none focus:ring-1 focus:ring-coral"
          />
        </section>
      )}

      {/* Capture chips — appear only when questions have arrived */}
      {form.captureQuestions.length > 0 && (
        <section>
          <CaptureChips
            questions={form.captureQuestions}
            onChange={(qs) => onChange('captureQuestions', qs)}
          />
        </section>
      )}

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
              <Loader2 className="h-5 w-5 animate-spin" />
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
