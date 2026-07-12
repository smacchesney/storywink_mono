'use client';

/**
 * X6d create chooser, the offer-not-gate variant the UX review locked in:
 * the photo path keeps its exact page (upload tray + coral Continue, zero
 * new taps); this card appears BENEATH it, only when the account has at
 * least one READY character, as the second way in. Remembered path gets a
 * soft ring — never an auto-navigation. Dark behind
 * NEXT_PUBLIC_AVATARS_ENABLED.
 */

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { AvatarSummary } from '@/components/characters/AvatarCard';
import { rememberCreatePath, readCreatePath } from '@/lib/createPath';

const KIND_EMOJI: Record<AvatarSummary['kind'], string> = {
  CHILD: '🧒',
  ADULT: '🧑',
  PET: '🐾',
  TOY: '🧸',
};

export function AvatarStoryCard() {
  const router = useRouter();
  const t = useTranslations('avatarStories');
  const [candidates, setCandidates] = useState<AvatarSummary[]>([]);
  const [showExplainer, setShowExplainer] = useState(false);
  const [wasLastPath, setWasLastPath] = useState(false);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AVATARS_ENABLED !== 'true') return;
    let cancelled = false;
    void (async () => {
      const res = await fetch('/api/avatars').catch(() => null);
      if (!res?.ok || cancelled) return;
      const data = (await res.json()) as { avatars: AvatarSummary[] };
      const ready = data.avatars.filter(
        (a) => a.status === 'READY' && a.renditions.some((r) => r.status === 'READY'),
      );
      if (cancelled || ready.length === 0) return;
      setCandidates(ready);
      setWasLastPath(readCreatePath() === 'avatars');
      // One-time explainer: shown on the card's first-ever appearance only.
      try {
        if (!localStorage.getItem('storywink-chooser-explained')) {
          setShowExplainer(true);
          localStorage.setItem('storywink-chooser-explained', '1');
        }
      } catch {
        /* storage unavailable — skip the explainer */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (candidates.length === 0) return null;

  const star = candidates.find((a) => a.kind === 'CHILD') ?? candidates[0];
  const faces = candidates.slice(0, 4);

  return (
    <div className="mx-auto mt-6 w-full max-w-md">
      <button
        type="button"
        onClick={() => {
          rememberCreatePath('avatars');
          router.push('/create/characters');
        }}
        className={`w-full rounded-2xl border-2 bg-white px-5 py-4 text-left shadow-sm transition-all hover:border-coral/60 hover:shadow-md ${
          wasLastPath ? 'border-coral/50 ring-2 ring-coral/20' : 'border-black/10'
        }`}
      >
        <div className="flex items-center gap-4">
          <div className="flex shrink-0 -space-x-3">
            {faces.map((a) => {
              const portrait = a.renditions.find((r) => r.portraitUrl)?.portraitUrl;
              return portrait ? (
                <img
                  key={a.id}
                  src={portrait}
                  alt={a.displayName}
                  className="h-12 w-12 rounded-full border-2 border-white bg-[#FFF9F5] object-cover shadow-sm"
                />
              ) : (
                <span
                  key={a.id}
                  aria-hidden="true"
                  className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white bg-[#FFF9F5] text-xl shadow-sm"
                >
                  {KIND_EMOJI[a.kind]}
                </span>
              );
            })}
          </div>
          <div className="min-w-0">
            <p className="font-playful text-base font-semibold text-[#1a1a1a]">
              {star.kind === 'CHILD'
                ? t('cardTitle', { name: star.displayName })
                : t('cardTitleGeneric')}
            </p>
            <p className="mt-0.5 text-sm text-gray-500">{t('cardSubtitle')}</p>
            {wasLastPath && (
              <p className="mt-1 text-xs font-medium text-coral">{t('cardLastTime')}</p>
            )}
          </div>
        </div>
      </button>
      {showExplainer && (
        <p className="mt-2 text-center text-xs text-gray-500">{t('cardExplainer')}</p>
      )}
    </div>
  );
}
