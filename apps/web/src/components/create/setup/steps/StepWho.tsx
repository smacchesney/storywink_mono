'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { WizardStepProps } from './step-props';

/** Step 1 — the one required field. The step heading doubles as the visible
 * label; the sr-only label keeps the ensemble-aware wording for AT users. */
export function StepWho({ form, prefilledName, showNameError, onChange }: WizardStepProps) {
  const t = useTranslations('setup');
  return (
    <section className="flex flex-col gap-1.5">
      <label htmlFor="childName" className="sr-only">
        {t(form.castMode === 'ensemble' ? 'childNameLabelEnsemble' : 'childNameLabel')}
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
      {showNameError && <p className="text-xs text-coral">{t('childNameRequired')}</p>}
      {!showNameError && prefilledName && form.childName === prefilledName && (
        <p className="text-xs text-gray-500">
          <Sparkles className="mr-1 inline h-3 w-3 text-coral" />
          {t('childNameAgain', { name: prefilledName })}
        </p>
      )}
    </section>
  );
}

export default StepWho;
