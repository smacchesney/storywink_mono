'use client';

import React from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { optimizeCloudinaryUrl } from '@storywink/shared';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Storydust } from '@/components/ui/storydust';
import ArtStyleStrip from '@/components/create/setup/ArtStyleStrip';
import LearningWords from '@/components/create/setup/LearningWords';
import { describeCharacter } from '@/components/create/setup/discovery-feed';
import type { WizardStepProps } from './step-props';

const RECAP_THUMBS = 5;

/** Step 4 — style, title, a read-only receipt, More options, and the flow's
 * only CTA. Photos are read-only here (tap → back to step 2): a photo edit
 * after the payoff would invalidate step-3 answers. */
export function StepFinish({
  form,
  photos,
  titlePending,
  isSubmitting,
  roster,
  onChange,
  onSubmit,
  goToStep,
}: WizardStepProps) {
  const t = useTranslations('setup');
  const [optionsOpen, setOptionsOpen] = React.useState(false);

  const star = roster.find((c) => c.characterId === form.starCharacterId);
  const starLabel =
    form.castMode === 'ensemble'
      ? t('recapCastEveryone')
      : star
        ? t('recapCast', { name: star.name ?? describeCharacter(star) })
        : null;

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        onClick={() => goToStep(2, 'recap')}
        aria-label={t('editPhotos')}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-2xl border border-black/10 bg-white px-3 py-2 text-left"
      >
        <span className="flex shrink-0 items-center gap-1">
          {photos.slice(0, RECAP_THUMBS).map((p) => {
            const src = p.thumbnailUrl || p.url;
            return (
              <span
                key={p.id}
                className="relative h-8 w-8 overflow-hidden rounded-lg border border-black/5 bg-gray-100"
              >
                {src ? (
                  <Image
                    src={optimizeCloudinaryUrl(src)}
                    alt=""
                    fill
                    sizes="32px"
                    className="object-cover"
                  />
                ) : null}
              </span>
            );
          })}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-gray-600">
          {t('recapPhotos', { count: photos.length })}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
      </button>

      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-600">{t('artStyleLabel')}</label>
        <ArtStyleStrip value={form.artStyle} onChange={(s) => onChange('artStyle', s)} />
      </section>

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
              <span className="font-playful text-sm">{t('titleThinking')}</span>
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => goToStep(1, 'recap')}
          className="flex min-h-[36px] items-center justify-between gap-2 text-left"
        >
          <span className="min-w-0 truncate text-sm text-gray-600">
            {t('recapFor', { name: form.childName.trim() })}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
        </button>
        {form.eventSummary.trim() && (
          <button
            type="button"
            onClick={() => goToStep(2, 'recap')}
            className="flex min-h-[36px] items-center justify-between gap-2 text-left"
          >
            <span className="min-w-0 truncate text-sm text-gray-600">
              {t('recapDay', { summary: form.eventSummary.trim() })}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          </button>
        )}
        {starLabel && (
          <button
            type="button"
            onClick={() => goToStep(3, 'recap')}
            className="flex min-h-[36px] items-center justify-between gap-2 text-left"
          >
            <span className="min-w-0 truncate text-sm text-gray-600">{starLabel}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          </button>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <button
          type="button"
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen((v) => !v)}
          className="min-h-[44px] self-start px-1 text-left font-playful text-sm text-gray-500 underline decoration-black/20 decoration-dashed underline-offset-4 transition-colors hover:text-gray-700"
        >
          {t('moreOptions')}
        </button>
        {optionsOpen && (
          <div className="flex flex-col gap-4">
            <LearningWords
              words={form.learningWords}
              onChange={(v) => onChange('learningWords', v)}
            />
            <div className="flex items-center justify-between">
              <label htmlFor="reviewFirst" className="text-sm text-gray-500">
                {t('reviewFirstLabel')}
              </label>
              <Switch
                id="reviewFirst"
                checked={form.reviewFirst}
                onCheckedChange={(v) => onChange('reviewFirst', v)}
              />
            </div>
          </div>
        )}
      </section>

      <button
        onClick={onSubmit}
        disabled={isSubmitting}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-coral px-6 py-3.5 font-playful text-lg text-white shadow-md transition-colors hover:bg-coral/90 disabled:opacity-70"
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
  );
}

export default StepFinish;
