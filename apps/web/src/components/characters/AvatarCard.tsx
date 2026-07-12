'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'framer-motion';
import { MoreVertical } from 'lucide-react';
import { optimizeCloudinaryUrl } from '@storywink/shared';
import StorybookFrame from '@/components/ui/storybook-frame';
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
    cutoutUrl: string | null;
    error: string | null;
  }>;
}

interface AvatarCardProps {
  avatar: AvatarSummary;
  /** Shelf position — drives the resting tilt pattern. */
  index?: number;
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

/** Subtle resting tilts, repeating across the shelf (example-book-selector precedent). */
const RESTING_TILTS = [-3, 0, 3];

/**
 * One collectible character card: a StorybookFrame "page" with the full-body
 * waving cutout large inside, name plate beneath, kind chip. Cards rest at a
 * subtle tilt and straighten/lift on hover (skipped under reduced motion).
 * Fallback chain: cutout → portrait crop → twinkle (drawing) → emoji.
 */
export function AvatarCard({ avatar, index = 0, onRename, onDrawAgain, onDelete }: AvatarCardProps) {
  const t = useTranslations('characters');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const prefersReduced = useReducedMotion() ?? false;
  const tilt = prefersReduced ? 0 : RESTING_TILTS[index % RESTING_TILTS.length];

  const ready = avatar.renditions.find(
    (r) => r.status === 'READY' && (r.cutoutUrl || r.portraitUrl),
  );
  const cutout = ready?.cutoutUrl ?? null;
  const portrait = ready?.portraitUrl ?? null;
  const pending = !ready && avatar.renditions.some((r) => r.status === 'PENDING');
  const failed = !ready && !pending && avatar.renditions.some((r) => r.status === 'FAILED');

  return (
    <motion.div
      className="relative"
      initial={false}
      animate={{ rotate: tilt }}
      whileHover={prefersReduced ? undefined : { rotate: 0, scale: 1.06, y: -10 }}
      whileTap={prefersReduced ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
    >
      <StorybookFrame className="shadow-[0_14px_30px_-18px_rgba(0,0,0,0.4)]">
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md bg-white">
          {cutout ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={optimizeCloudinaryUrl(cutout, { additionalTransforms: 'c_limit,h_900' })}
              alt={t('cutoutAlt', { name: avatar.displayName })}
              className="h-full w-full object-contain"
              loading="lazy"
            />
          ) : portrait ? (
            // Portrait crop fallback stays object-cover — a face-height zone,
            // never letterboxed next to full-body neighbours.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={portrait}
              alt={t('portraitAlt', { name: avatar.displayName })}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : pending ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2">
              <Storydust
                variant="twinkle"
                size="card"
                label={t('drawing', { name: avatar.displayName })}
              />
              <p className="text-working-shimmer font-playful text-sm text-gray-500">
                {t('drawing', { name: avatar.displayName })}
              </p>
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
              <span className="text-4xl" aria-hidden>
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

        <div className="flex items-center gap-1.5 px-1 pb-0.5 pt-1.5">
          <span aria-hidden className="text-sm">
            {KIND_EMOJI[avatar.kind]}
          </span>
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
      </StorybookFrame>

      {menuOpen && (
        <div className="absolute bottom-12 right-2 z-20 flex flex-col rounded-xl border border-black/10 bg-white py-1 shadow-lg">
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
    </motion.div>
  );
}

export default AvatarCard;
