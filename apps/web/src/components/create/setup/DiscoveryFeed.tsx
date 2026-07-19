'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { DiscoveryChip } from '@/components/create/setup/discovery-feed';

export const CHIP_STAGGER_MS = 350;

/**
 * X17 B1 — the perception pass's real findings, cascading in as quiet data
 * chips under the librarian strip. Chips are Geist (they are data); the
 * header line is Excalifont narration. Non-interactive by design: the
 * ramble is the correction channel, so a wrong guess reads as charm.
 */
export function DiscoveryFeed({ chips }: { chips: DiscoveryChip[] }) {
  const t = useTranslations('setup');
  const playful = useLocale() === 'ja' ? 'font-japanese' : 'font-playful';
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <p className={`${playful} text-sm text-gray-600`}>{t('feedSpotted')}</p>
      <ul className="flex flex-wrap gap-1.5">
        {chips.map((chip, i) => (
          <li
            key={chip.id}
            className="feed-chip rounded-full border border-black/10 bg-white px-3 py-1 text-sm text-gray-700"
            style={{ animationDelay: `${i * CHIP_STAGGER_MS}ms` }}
          >
            {chip.label}
          </li>
        ))}
      </ul>
      <style jsx global>{`
        .feed-chip {
          animation: feed-chip-rise 300ms ease-out both;
        }
        @keyframes feed-chip-rise {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .feed-chip {
            animation-name: feed-chip-fade;
            animation-delay: 0ms;
          }
          @keyframes feed-chip-fade {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
        }
      `}</style>
    </div>
  );
}

export default DiscoveryFeed;
