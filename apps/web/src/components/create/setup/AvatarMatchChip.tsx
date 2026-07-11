'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

interface AvatarMatchChipProps {
  bookId: string;
  /** The perception roster id of this book's star (main_child). */
  mainCharacterId: string;
}

interface CandidateAvatar {
  id: string;
  displayName: string;
  kind: string;
  promotedFromBookId?: string | null;
  renditions: Array<{ status: string; portraitUrl: string | null }>;
}

/**
 * X6c: one quiet confirm row — "Is this {avatarName}?" — shown when the
 * account has a ready child character. Yes links the avatar so its master
 * sheet anchors this book's illustrations; "not them" dismisses for the
 * session. Renders nothing while the flag is off or no candidate exists.
 */
export function AvatarMatchChip({ bookId, mainCharacterId }: AvatarMatchChipProps) {
  const t = useTranslations('characters');
  const [candidate, setCandidate] = React.useState<CandidateAvatar | null>(null);
  const [state, setState] = React.useState<'idle' | 'saving' | 'linked' | 'dismissed'>('idle');

  React.useEffect(() => {
    if (process.env.NEXT_PUBLIC_AVATARS_ENABLED !== 'true') return;
    let cancelled = false;
    void (async () => {
      const res = await fetch('/api/avatars').catch(() => null);
      if (!res?.ok || cancelled) return;
      const data = (await res.json()) as { avatars: CandidateAvatar[] };
      const ready = data.avatars.find(
        (a) => a.kind === 'CHILD' && a.renditions.some((r) => r.status === 'READY'),
      );
      if (ready) setCandidate(ready);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!candidate || state === 'dismissed') return null;

  const portrait = candidate.renditions.find((r) => r.portraitUrl)?.portraitUrl;

  const link = async () => {
    setState('saving');
    try {
      const res = await fetch(`/api/book/${bookId}/avatar-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarId: candidate.id, characterId: mainCharacterId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState('linked');
    } catch {
      setState('idle');
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-2xl bg-coral/5 px-3 py-2">
      {portrait && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={portrait}
          alt=""
          className="h-9 w-9 shrink-0 rounded-full border border-white object-cover shadow-sm"
        />
      )}
      {state === 'linked' ? (
        <p className="font-playful text-sm text-gray-600">
          {t('matchLinked', { name: candidate.displayName })}
        </p>
      ) : (
        <>
          <p className="min-w-0 flex-1 font-playful text-sm text-gray-700">
            {t('matchQuestion', { name: candidate.displayName })}
          </p>
          <button
            type="button"
            disabled={state === 'saving'}
            onClick={link}
            className={cn(
              'rounded-full border px-3 py-1 font-playful text-sm transition-colors',
              'border-coral bg-coral text-white hover:bg-coral/90 disabled:opacity-60',
            )}
          >
            {t('matchYes')}
          </button>
          <button
            type="button"
            onClick={() => setState('dismissed')}
            className="rounded-full border border-transparent px-2 py-1 font-playful text-sm text-gray-400 hover:text-gray-600"
          >
            {t('matchNo')}
          </button>
        </>
      )}
    </div>
  );
}

export default AvatarMatchChip;
