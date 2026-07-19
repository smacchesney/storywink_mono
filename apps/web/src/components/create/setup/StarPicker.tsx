'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  describeCharacter,
  type RosterCharacterLike,
} from '@/components/create/setup/discovery-feed';

interface StarPickerProps {
  childrenChars: RosterCharacterLike[];
  castMode: 'star' | 'ensemble';
  starCharacterId: string | null;
  /** ENSEMBLE_BOOKS client flag — hides "Everyone!" while keeping the star fix. */
  ensembleAllowed: boolean;
  onPickStar: (character: RosterCharacterLike) => void;
  onPickEveryone: () => void;
}

/**
 * X17 B3 — "Who's the star?". The caller gates on 2+ recurring kids; solo
 * books never see this. One tap kills the wrong-sibling coin flip;
 * "Everyone!" flips the book to ensemble mode.
 */
export function StarPicker({
  childrenChars,
  castMode,
  starCharacterId,
  ensembleAllowed,
  onPickStar,
  onPickEveryone,
}: StarPickerProps) {
  const t = useTranslations('setup');
  return (
    <section className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-600">{t('starLabel')}</label>
      <div className="flex flex-wrap items-center gap-1.5">
        {childrenChars.map((c) => {
          const active = castMode === 'star' && starCharacterId === c.characterId;
          return (
            <button
              key={c.characterId}
              type="button"
              aria-pressed={active}
              onClick={() => onPickStar(c)}
              className={cn(
                'min-h-[44px] rounded-full border px-4 py-1 font-playful text-sm transition-colors',
                active
                  ? 'border-coral bg-coral text-white'
                  : 'border-black/10 bg-white text-gray-700 hover:border-coral/50',
              )}
            >
              {describeCharacter(c)}
            </button>
          );
        })}
        {ensembleAllowed && (
          <button
            type="button"
            aria-pressed={castMode === 'ensemble'}
            onClick={onPickEveryone}
            className={cn(
              'min-h-[44px] rounded-full border-2 px-4 py-1 font-playful text-sm transition-colors',
              castMode === 'ensemble'
                ? 'border-coral bg-coral text-white'
                : 'border-coral bg-white text-coral hover:bg-coral/10',
            )}
          >
            {t('starEveryone')}
          </button>
        )}
      </div>
    </section>
  );
}

export default StarPicker;
