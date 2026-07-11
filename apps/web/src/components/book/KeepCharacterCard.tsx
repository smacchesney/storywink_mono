'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

interface KeepCharacterCardProps {
  bookId: string;
  characterId: string;
  childName: string;
  onDismiss: () => void;
}

/**
 * X6a promotion, shown once right after the reveal: one warm card that turns
 * the book's star into an account character. Declining dismisses for this
 * book (a later book's reveal offers again); keeping links to the shelf.
 */
export function KeepCharacterCard({
  bookId,
  characterId,
  childName,
  onDismiss,
}: KeepCharacterCardProps) {
  const t = useTranslations('characters');
  const [state, setState] = React.useState<'idle' | 'saving' | 'kept'>('idle');

  const keep = async () => {
    setState('saving');
    try {
      const res = await fetch('/api/avatar/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, characterId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState('kept');
    } catch {
      setState('idle');
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      <div className="flex w-full max-w-sm flex-col gap-2 rounded-2xl border border-black/10 bg-white/95 p-4 shadow-xl backdrop-blur">
        {state === 'kept' ? (
          <>
            <p className="font-playful text-base text-[#1a1a1a]">
              {t('keptTitle', { name: childName })}
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onDismiss}
                className="min-h-[44px] px-2 font-playful text-sm text-gray-500"
              >
                {t('keptClose')}
              </button>
              <Link
                href="/characters"
                className="flex min-h-[44px] items-center rounded-full bg-coral px-4 font-playful text-sm text-white hover:bg-coral/90"
              >
                {t('keptSee')}
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="font-playful text-base text-[#1a1a1a]">
              {t('keepTitle', { name: childName })}
            </p>
            <p className="font-playful text-sm text-gray-500">{t('keepBody')}</p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onDismiss}
                disabled={state === 'saving'}
                className="min-h-[44px] px-2 font-playful text-sm text-gray-500 hover:text-gray-700"
              >
                {t('keepNotNow')}
              </button>
              <button
                type="button"
                onClick={keep}
                disabled={state === 'saving'}
                className="flex min-h-[44px] items-center rounded-full bg-coral px-4 font-playful text-sm text-white hover:bg-coral/90 disabled:opacity-60"
              >
                {state === 'saving' ? t('keepSaving') : t('keepYes', { name: childName })}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default KeepCharacterCard;
