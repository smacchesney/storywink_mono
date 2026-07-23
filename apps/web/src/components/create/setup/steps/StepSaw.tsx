'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import CastRow from '@/components/create/setup/CastRow';
import DiscoveryFeed from '@/components/create/setup/DiscoveryFeed';
import ThemeCard from '@/components/create/setup/ThemeCard';
import CaptureChips from '@/components/create/setup/CaptureChips';
import ReadingRibbon from '@/components/create/setup/ReadingRibbon';
import {
  deriveStep3State,
  perceptionQuestionCount,
} from '@/components/create/setup/wizard-steps';
import type { WizardStepProps } from './step-props';

/** Step 3 — the payoff. Reading theater (incl. photo-mutation re-reads),
 * the landed reveal, or one honest settled-empty line. Never blocks. */
export function StepSaw({
  form,
  photos,
  bookId,
  stripPhase,
  reReading,
  discoveryChips,
  roster,
  pages,
  recurringKidCount,
  ensembleAllowed,
  onChange,
  onPickStar,
  onPickEveryone,
}: WizardStepProps) {
  const t = useTranslations('setup');
  const playful = useLocale() === 'ja' ? 'font-japanese' : 'font-playful';

  const state = deriveStep3State(
    stripPhase,
    {
      rosterCount: roster.length,
      chipCount: discoveryChips.length,
      themeLine: form.themeLine,
      perceptionQuestionCount: perceptionQuestionCount(form.captureQuestions),
    },
    reReading,
  );

  if (state === 'reading') {
    return <ReadingRibbon phase={reReading ? 'reading' : stripPhase} photos={photos} hero />;
  }

  if (state === 'settledEmpty') {
    return <p className={`${playful} text-base text-gray-600`}>{t('readerSlow')}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <CastRow
        bookId={bookId}
        roster={roster}
        pages={pages}
        questions={form.captureQuestions}
        castMode={form.castMode}
        starCharacterId={form.starCharacterId}
        childName={form.childName}
        recurringKidCount={recurringKidCount}
        reading={false}
        ensembleAllowed={ensembleAllowed}
        onPickStar={onPickStar}
        onPickEveryone={onPickEveryone}
        onQuestionsChange={(qs) => onChange('captureQuestions', qs)}
      />
      <DiscoveryFeed chips={discoveryChips} reserve={false} />
      <ThemeCard
        themeLine={form.themeLine}
        label={t('themeWeThink')}
        onChange={(v) => onChange('themeLine', v)}
      />
      <CaptureChips
        questions={form.captureQuestions}
        caps={form.castMode === 'ensemble' ? { naming: 4, total: 5 } : undefined}
        onChange={(qs) => onChange('captureQuestions', qs)}
      />
    </div>
  );
}

export default StepSaw;
