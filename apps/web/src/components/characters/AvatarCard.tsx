'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { MoreVertical } from 'lucide-react';
import { Storydust } from '@/components/ui/storydust';
import { cn } from '@/lib/utils';

export interface AvatarSummary {
  id: string;
  displayName: string;
  kind: 'CHILD' | 'ADULT' | 'PET' | 'TOY';
  status: 'DRAFT' | 'READY';
  renditions: Array<{
    artStyle: string;
    status: 'PENDING' | 'READY' | 'FAILED';
    turnaroundSheetUrl: string | null;
    portraitUrl: string | null;
    error: string | null;
  }>;
}

interface AvatarCardProps {
  avatar: AvatarSummary;
  onRename: (avatar: AvatarSummary) => void;
  onDrawAgain: (avatar: AvatarSummary) => void;
  onDelete: (avatar: AvatarSummary) => void;
}

const KIND_EMOJI: Record<AvatarSummary['kind'], string> = {
  CHILD: '🧒',
  ADULT: '🧑',
  PET: '🐾',
  TOY: '🧸',
};

/**
 * One collectible character card: the styled portrait (front panel of the
 * turnaround sheet), a playful name, a kind badge, and per-style dots.
 * Pending renditions twinkle; failures offer a warm "draw again".
 */
export function AvatarCard({ avatar, onRename, onDrawAgain, onDelete }: AvatarCardProps) {
  const t = useTranslations('characters');
  const [menuOpen, setMenuOpen] = React.useState(false);

  const ready = avatar.renditions.find((r) => r.status === 'READY' && r.portraitUrl);
  const pending = avatar.renditions.some((r) => r.status === 'PENDING');
  const failed = !ready && !pending && avatar.renditions.some((r) => r.status === 'FAILED');

  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_10px_24px_-14px_rgba(0,0,0,0.35)]">
      <div className="relative aspect-square w-full overflow-hidden bg-[#FFFDF8]">
        {ready?.portraitUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ready.portraitUrl}
            alt={t('portraitAlt', { name: avatar.displayName })}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : pending ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
            <Storydust variant="twinkle" size="card" label={t('drawing', { name: avatar.displayName })} />
            <p className="font-playful text-sm text-gray-500 text-working-shimmer">
              {t('drawing', { name: avatar.displayName })}
            </p>
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="text-3xl" aria-hidden>
              {KIND_EMOJI[avatar.kind]}
            </span>
            {failed && (
              <button
                type="button"
                onClick={() => onDrawAgain(avatar)}
                className="rounded-full border border-coral px-3 py-1 font-playful text-sm text-coral hover:bg-coral hover:text-white"
              >
                {t('drawAgain')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2">
        <span aria-hidden>{KIND_EMOJI[avatar.kind]}</span>
        <span className="min-w-0 flex-1 truncate font-playful text-base text-[#1a1a1a]">
          {avatar.displayName}
        </span>
        <button
          type="button"
          aria-label={t('cardMenu', { name: avatar.displayName })}
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded-full p-1.5 text-gray-400 hover:bg-black/5 hover:text-gray-700"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>

      {menuOpen && (
        <div className="absolute bottom-11 right-2 z-10 flex flex-col rounded-xl border border-black/10 bg-white py-1 shadow-lg">
          {(
            [
              ['rename', () => onRename(avatar)],
              ['drawAgain', () => onDrawAgain(avatar)],
              ['delete', () => onDelete(avatar)],
            ] as const
          ).map(([key, action]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setMenuOpen(false);
                action();
              }}
              className={cn(
                'px-4 py-2 text-left font-playful text-sm hover:bg-black/5',
                key === 'delete' ? 'text-red-500' : 'text-gray-700',
              )}
            >
              {t(key)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default AvatarCard;
