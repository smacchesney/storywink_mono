'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useReducedMotion } from 'framer-motion';
import type { DiscoveryChip } from '@/components/create/setup/discovery-feed';

export const CHIP_STAGGER_MS = 350;

/**
 * Reserved feed floor, held whenever the feed renders — mirrors the
 * CaptureChips reserve (SetupSheet's `minHeight: 96`). The feed sits below the
 * child-name field, so this floor never moves the name field; it only keeps
 * content below the feed from shifting until chip content exceeds 96px, which
 * matches the accepted CaptureChips-region behavior below a focused field.
 */
export const FEED_RESERVE_MIN_HEIGHT = 96;

/**
 * X17 B1 — the perception pass's real findings, cascading in as quiet data
 * chips below the child-name field, directly above the capture-chips region.
 * Chips are Geist (they are data); the header line is Excalifont narration.
 * Non-interactive by design: the ramble is the correction channel, so a wrong
 * guess reads as charm.
 *
 * `reserve` (true while the strip is still reading) arms a live region with a
 * stable min-height floor already mounted, so chips arrive without a shift
 * above them and screen readers announce the mutation. The floor is HELD once
 * chips land (it does not drop to undefined), so the only thing that can move
 * is content below the feed, and only when chips exceed the floor. Once
 * reading settles with no chips the box collapses (nothing more will arrive).
 */
export function DiscoveryFeed({ chips, reserve }: { chips: DiscoveryChip[]; reserve?: boolean }) {
  const t = useTranslations('setup');
  const playful = useLocale() === 'ja' ? 'font-japanese' : 'font-playful';
  const reducedMotion = useReducedMotion() ?? false;

  const hasChips = chips.length > 0;
  // Reserve empty space only while reading and no chips yet; the aria-live
  // region still mounts here so the later mutation is announced.
  const reserveSpace = !!reserve && !hasChips;
  // Collapse entirely when nothing is reserved and no chips are present —
  // flag-off never reaches here (the whole block is gated in SetupSheet).
  if (!reserveSpace && !hasChips) return null;

  return (
    <div
      className="flex flex-col gap-1.5"
      // Hold the floor whenever the feed renders (reserve OR chips present) so
      // it never drops when chips land; the feed lives below the name field,
      // so this can only shift content beneath it, never the name field.
      style={{ minHeight: FEED_RESERVE_MIN_HEIGHT }}
      aria-live="polite"
    >
      {hasChips && (
        <>
          <p className={`${playful} text-sm text-gray-600`}>{t('feedSpotted')}</p>
          <ul className="flex flex-wrap gap-1.5">
            {chips.map((chip, i) => {
              // Stagger the cascade in JS so reduced-motion is actually zeroed —
              // an inline animationDelay outranks any media-query override.
              const delay = reducedMotion ? 0 : i * CHIP_STAGGER_MS;
              return (
                <li
                  key={chip.id}
                  className="feed-chip rounded-full border border-black/10 bg-white px-3 py-1 text-sm text-gray-700"
                  style={{ animationDelay: `${delay}ms` }}
                >
                  {chip.label}
                </li>
              );
            })}
          </ul>
        </>
      )}
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
