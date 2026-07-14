'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { motion, useReducedMotion } from 'framer-motion';
import { MoreVertical, X, Check } from 'lucide-react';
import { optimizeCloudinaryUrl } from '@storywink/shared';
import {
  getAllStyleKeys,
  getStylePreviewUrl,
  type StyleKey,
} from '@storywink/shared/prompts/styles';
import StorybookFrame from '@/components/ui/storybook-frame';
import { Storydust } from '@/components/ui/storydust';
import { styleLabelKey } from '@/lib/styleLabelKey';
import { displayableStyles, showSwatchRow, swatchState } from '@/lib/avatarWardrobe';
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
  /** Redraws the DISPLAYED style (C3); the card passes what it is showing. */
  onDrawAgain: (avatar: AvatarSummary, displayedStyle: StyleKey | null) => void;
  onDelete: (avatar: AvatarSummary) => void;
  /**
   * Draws a specific new style from the "…'s styles" sheet. Optional: absent it,
   * the sheet and its kebab entry stay hidden (the sheet is a shelf feature).
   */
  onDrawStyle?: (avatar: AvatarSummary, style: StyleKey) => void;
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
export function AvatarCard({
  avatar,
  index = 0,
  onRename,
  onDrawAgain,
  onDelete,
  onDrawStyle,
}: AvatarCardProps) {
  const t = useTranslations('characters');
  const tSetup = useTranslations('setup');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  // Which outfit the card is showing. Null until the parent taps a swatch —
  // then it wins as long as it stays displayable, else the deterministic
  // key-order default (displayable[0]) shows.
  const [displayed, setDisplayed] = React.useState<StyleKey | null>(null);
  const prefersReduced = useReducedMotion() ?? false;
  const tilt = prefersReduced ? 0 : RESTING_TILTS[index % RESTING_TILTS.length];

  // The wardrobe: existing outfits in STYLE_LIBRARY key order. The swatch row
  // shows ONLY with ≥2 — a single outfit (the 90% case) adds zero chrome.
  const wardrobe = displayableStyles(avatar.renditions);
  const activeStyle = displayed && wardrobe.includes(displayed) ? displayed : (wardrobe[0] ?? null);
  const swatches = showSwatchRow(avatar.renditions) ? wardrobe : [];

  const shown = activeStyle
    ? avatar.renditions.find(
        (r) => r.artStyle === activeStyle && r.status === 'READY' && (r.cutoutUrl || r.portraitUrl),
      )
    : undefined;
  const cutout = shown?.cutoutUrl ?? null;
  const portrait = shown?.portraitUrl ?? null;
  const pending = !shown && avatar.renditions.some((r) => r.status === 'PENDING');
  const failed = !shown && !pending && avatar.renditions.some((r) => r.status === 'FAILED');

  return (
    <motion.div
      className="relative"
      initial={false}
      animate={{ rotate: tilt }}
      // zIndex rides the lift (example-book-selector precedent): without it a
      // hovered card's grown edges paint UNDER later-DOM neighbours.
      whileHover={prefersReduced ? undefined : { rotate: 0, scale: 1.06, y: -10, zIndex: 10 }}
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
                  onClick={() => onDrawAgain(avatar, activeStyle)}
                  className="rounded-full border border-coral px-3 py-1 font-playful text-sm text-coral hover:bg-coral hover:text-white"
                >
                  {t('drawAgain')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* C1: read-only wardrobe — one swatch per existing outfit, tap to
            switch the displayed art (pure client state). Only shown with ≥2. */}
        {swatches.length > 0 && (
          <div className="flex items-center gap-1.5 px-1 pt-1.5" role="group">
            {swatches.map((style) => {
              const isActive = style === activeStyle;
              return (
                <button
                  key={style}
                  type="button"
                  aria-pressed={isActive}
                  aria-label={t('styleShowing', { style: tSetup(styleLabelKey(style)) })}
                  onClick={() => setDisplayed(style)}
                  className={cn(
                    'h-7 w-7 shrink-0 overflow-hidden rounded-full border-2 transition-all',
                    isActive
                      ? 'border-coral ring-1 ring-coral/40'
                      : 'border-black/15 hover:border-coral/50',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={optimizeCloudinaryUrl(getStylePreviewUrl(style), {
                      additionalTransforms: 'c_fill,w_80,h_80',
                    })}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </button>
              );
            })}
          </div>
        )}

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
          <MenuItem
            label={t('rename')}
            onClick={() => {
              setMenuOpen(false);
              onRename(avatar);
            }}
          />
          <MenuItem
            label={t('drawAgain')}
            onClick={() => {
              setMenuOpen(false);
              onDrawAgain(avatar, activeStyle);
            }}
          />
          {/* C2: the explicit, labeled entry to the restyle sheet. */}
          {onDrawStyle && (
            <MenuItem
              label={t('styleSheetTitle', { name: avatar.displayName })}
              onClick={() => {
                setMenuOpen(false);
                setSheetOpen(true);
              }}
            />
          )}
          <MenuItem
            label={t('delete')}
            danger
            onClick={() => {
              setMenuOpen(false);
              onDelete(avatar);
            }}
          />
        </div>
      )}

      {sheetOpen && onDrawStyle && (
        <StyleWardrobeSheet
          avatar={avatar}
          onClose={() => setSheetOpen(false)}
          onDraw={(style) => onDrawStyle(avatar, style)}
        />
      )}
    </motion.div>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-4 py-2 text-left font-playful text-sm hover:bg-black/5',
        danger ? 'text-red-500' : 'text-gray-700',
      )}
    >
      {label}
    </button>
  );
}

/**
 * C2: the "{name}'s styles" sheet — the ONLY paid restyle control. Portaled to
 * document.body so it escapes the shelf's `main` (z-10) stacking context and
 * paints over the sticky header (AvatarStudioDialog precedent). Each of the
 * three styles shows its state: drawn ✓, drawing…, or a "Draw {name} in {style}"
 * CTA (undrawn and failed both offer it, so a failed style becomes a retry row).
 */
function StyleWardrobeSheet({
  avatar,
  onClose,
  onDraw,
}: {
  avatar: AvatarSummary;
  onClose: () => void;
  onDraw: (style: StyleKey) => void;
}) {
  const t = useTranslations('characters');
  const tSetup = useTranslations('setup');
  // Optimistic flip so the tapped row reads "drawing…" instantly; the shelf's
  // 4s poll then reconciles it to the real PENDING rendition.
  const [justDrew, setJustDrew] = React.useState<Set<string>>(new Set());

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 md:items-center"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-sm flex-col gap-3 rounded-t-2xl bg-white p-5 md:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label={t('close')}
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-2 text-gray-400 hover:bg-black/5"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="pr-8 font-playful text-xl text-[#1a1a1a]">
          {t('styleSheetTitle', { name: avatar.displayName })}
        </h2>

        <div className="flex flex-col gap-2">
          {getAllStyleKeys().map((style) => {
            const rendition = avatar.renditions.find((r) => r.artStyle === style);
            const state = justDrew.has(style) ? 'drawing' : swatchState(rendition);
            const label = tSetup(styleLabelKey(style));
            return (
              <div
                key={style}
                className="flex items-center gap-3 rounded-2xl border border-black/10 p-2.5"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={optimizeCloudinaryUrl(getStylePreviewUrl(style), {
                    additionalTransforms: 'c_fill,w_120,h_120',
                  })}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-xl object-cover"
                  loading="lazy"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-playful text-base text-[#1a1a1a]">{label}</span>
                  {state === 'drawn' ? (
                    <span className="flex items-center gap-1 font-playful text-sm text-coral">
                      <Check className="h-4 w-4" strokeWidth={3} />
                      {t('styleDrawn')}
                    </span>
                  ) : state === 'drawing' ? (
                    <span className="text-working-shimmer flex items-center gap-1.5 font-playful text-sm text-gray-500">
                      <Storydust variant="twinkle" size="inline" />
                      {t('styleDrawing')}
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setJustDrew((prev) => new Set(prev).add(style));
                          onDraw(style);
                        }}
                        className="self-start rounded-full bg-coral px-3 py-1.5 font-playful text-sm text-white hover:bg-coral/90"
                      >
                        {t('styleDrawIn', { name: avatar.displayName, style: label })}
                      </button>
                      <span className="text-xs text-gray-400">{t('styleSwatchWait')}</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default AvatarCard;
