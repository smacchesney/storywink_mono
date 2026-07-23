'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import PhotoStrip from '@/components/create/setup/PhotoStrip';
import ToneRow from '@/components/create/setup/ToneRow';
import RambleTextarea from '@/components/create/setup/RambleTextarea';
import type { WizardStepProps } from './step-props';

/** Step 2 — photos (editable, gated), tone, ramble. Typing here buys the
 * 15-45s the perception pass needs before step 3. */
export function StepDay({
  form,
  photos,
  bookId,
  stripPhase,
  coverAssetId,
  onChange,
  onReorder,
  onPhotosChanged,
  onPhotoPendingDelta,
  onRambleBlur,
}: WizardStepProps) {
  const t = useTranslations('setup');
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-600">{t('photosLabel')}</label>
        <PhotoStrip
          photos={photos}
          onReorder={onReorder}
          bookId={bookId}
          onPhotosChanged={onPhotosChanged}
          onPendingChange={onPhotoPendingDelta}
          reading={stripPhase === 'reading'}
          hasPhotoCover={coverAssetId !== null}
        />
        <p className="text-xs text-gray-500">{t('photoOrderHint')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-600">{t('howToTellIt')}</label>
        <ToneRow tone={form.tone} onToneChange={(v) => onChange('tone', v)} />
      </section>

      <section className="flex flex-col gap-1.5">
        <p className="font-playful text-sm text-gray-600">{t('rambleLabel')}</p>
        <RambleTextarea
          value={form.eventSummary}
          onChange={(v) => onChange('eventSummary', v)}
          onBlur={onRambleBlur}
          placeholder={t('eventSummaryPlaceholder')}
          hint={t('eventSummaryHint')}
        />
      </section>
    </div>
  );
}

export default StepDay;
