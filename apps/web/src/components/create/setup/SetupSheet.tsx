'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { Storydust } from '@/components/ui/storydust';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { StyleKey } from '@storywink/shared/prompts/styles';
import type { StoryMood } from '@storywink/shared/constants';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { track } from '@/lib/track';
import PhotoStrip, { StripPhoto } from '@/components/create/setup/PhotoStrip';
import ArtStyleStrip from '@/components/create/setup/ArtStyleStrip';
import LibrarianStrip from '@/components/create/setup/LibrarianStrip';
import StoryFraming from '@/components/create/setup/StoryFraming';
import type { StripPhase } from '@/components/create/setup/strip-phase';
import AvatarMatchChip from '@/components/create/setup/AvatarMatchChip';
import CaptureChips, { CaptureQuestion } from '@/components/create/setup/CaptureChips';
import type { DiscoveryChip, RosterCharacterLike } from '@/components/create/setup/discovery-feed';
import { recurringChildren } from '@/components/create/setup/discovery-feed';
import DiscoveryFeed from '@/components/create/setup/DiscoveryFeed';
import ThemeCard from '@/components/create/setup/ThemeCard';
import CastRow from '@/components/create/setup/CastRow';
import { CREATE_DISCOVERY_FLAG, ENSEMBLE_BOOKS_FLAG } from '@/lib/discovery-client';

export interface SetupFormState {
  childName: string;
  title: string;
  eventSummary: string;
  captureQuestions: CaptureQuestion[];
  artStyle: StyleKey;
  tone: StoryMood | null;
  learningWords: string[];
  reviewFirst: boolean;
  /** X17b: theme card + star ask. Defaults keep legacy books inert. */
  themeLine: string;
  castMode: 'star' | 'ensemble';
  starCharacterId: string | null;
  castMemberIds: string[];
}

interface SetupSheetProps {
  photos: StripPhoto[];
  form: SetupFormState;
  /**
   * Child name the server prefilled from the parent's most recent book.
   * While the field still holds it, a one-line "for {name} again!" shows
   * under the input; any edit makes the line step aside.
   */
  prefilledName?: string | null;
  /** True until perception fills the title — drives the shimmer. */
  titlePending: boolean;
  /** Librarian-strip phase — 'hidden' keeps the strip unmounted. */
  stripPhase: StripPhase;
  /** True once the parent edited the summary (telemetry only). */
  summaryEdited: boolean;
  isSubmitting: boolean;
  showNameError: boolean;
  /** Book id — enables the inline add/remove affordances in the photo strip. */
  bookId?: string;
  /** Perception roster id of this book's star, for the avatar confirm row. */
  mainCharacterId?: string | null;
  /**
   * X17b discovery surface — analysis-derived chips, the perception roster,
   * and the composed-cover asset. Plumbed here for Tasks 6-11 to render behind
   * the CREATE_DISCOVERY flag; unread today, so flag-off output is unchanged.
   */
  discoveryChips?: DiscoveryChip[];
  roster?: RosterCharacterLike[];
  coverAssetId?: string | null;
  /** Face-crop sources for CastRow — plumbed from the setup page's BookData.pages. */
  pages?: Array<{
    assetId: string | null;
    asset?: { url: string | null; thumbnailUrl: string | null } | null;
  }>;
  onReorder: (photos: StripPhoto[]) => void;
  /** Refetch trigger after photos are added/removed inline. */
  onPhotosChanged?: () => void | Promise<void>;
  onChange: <K extends keyof SetupFormState>(key: K, value: SetupFormState[K]) => void;
  /** X17 B3 — star pick fixes the name binding; Everyone flips ensemble mode. */
  onPickStar: (character: RosterCharacterLike) => void;
  onPickEveryone: () => void;
  /** X17 B4 — ramble blur fires the perception extract (wired in Task 13). */
  onRambleBlur?: () => void;
  onSubmit: () => void;
}

/**
 * The single pre-generation surface. Top to bottom: photo strip (cover =
 * first), the one required field (child name), an AI-prefilled title, the
 * "what we see" experience brief, capture chips, an art-style strip, a
 * quiet review toggle, and the coral "Make my book" button.
 */
export function SetupSheet({
  photos,
  form,
  prefilledName,
  titlePending,
  stripPhase,
  summaryEdited,
  isSubmitting,
  showNameError,
  bookId,
  mainCharacterId,
  discoveryChips,
  roster,
  coverAssetId,
  pages,
  onReorder,
  onPhotosChanged,
  onChange,
  onPickStar,
  onPickEveryone,
  onRambleBlur,
  onSubmit,
}: SetupSheetProps) {
  const t = useTranslations('setup');
  const reducedMotion = useReducedMotion() ?? false;

  // X17 B3 — the star ask renders only when the roster holds 2+ recurring kids;
  // solo books never see it (empty array → block below stays unrendered).
  const starChildren = recurringChildren(roster ?? []);

  const hasChips = form.captureQuestions.length > 0;
  // Reserved chips space while the librarian is still reading — arrival then
  // animates INSIDE this box, so nothing below it ever shifts. Collapses
  // gently (transition on min-height) when reading ends with zero questions.
  const reserveChipSpace = stripPhase === 'reading' && !hasChips;

  const handleSubmitClick = () => {
    // Funnel telemetry — fire only for taps that pass the one required field,
    // matching what actually submits (fire-and-forget, never blocks).
    if (form.childName.trim()) {
      track('setup_submitted', {
        ...(bookId ? { bookId } : {}),
        props: {
          reviewFirst: form.reviewFirst,
          chipsAnswered: form.captureQuestions.filter((q) => q.answer && q.answer !== '__skip__')
            .length,
          ...(form.tone ? { tone: form.tone } : {}),
          stripPhaseAtSubmit: stripPhase,
          summaryEdited,
        },
      });
    }
    onSubmit();
  };

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 pt-4 pb-28">
      {/* Photos */}
      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-600">{t('photosLabel')}</label>
        <PhotoStrip
          photos={photos}
          onReorder={onReorder}
          bookId={bookId}
          onPhotosChanged={onPhotosChanged}
          reading={CREATE_DISCOVERY_FLAG && stripPhase === 'reading'}
          hasPhotoCover={coverAssetId !== null}
        />
      </section>

      {/* Librarian strip — narrates the perception pass; never mounts when
          nothing is plausibly in flight, never collapses once mounted. */}
      {stripPhase !== 'hidden' && (
        <LibrarianStrip phase={stripPhase} questionCount={form.captureQuestions.length} />
      )}

      {/* Child name — the one required field */}
      <section className="flex flex-col gap-1.5">
        <label htmlFor="childName" className="text-sm font-medium text-gray-600">
          {t(
            CREATE_DISCOVERY_FLAG && form.castMode === 'ensemble'
              ? 'childNameLabelEnsemble'
              : 'childNameLabel',
          )}
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

      {/* Title — AI-prefilled with a thinking shimmer */}
      <section className="flex flex-col gap-1.5">
        <label htmlFor="title" className="text-sm font-medium text-gray-600">
          {t('titleLabel')}
        </label>
        <div className="relative">
          <Input
            id="title"
            value={form.title}
            onChange={(e) => onChange('title', e.target.value)}
            placeholder={titlePending ? '' : t('titlePlaceholder')}
            maxLength={100}
            className="font-playful text-base"
          />
          {titlePending && !form.title && (
            <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center gap-2 text-gray-400">
              <Storydust variant="twinkle" size="inline" />
              <span className="font-playful text-sm">{t('titleThinking')}</span>
            </div>
          )}
        </div>
      </section>

      {/* X17b — flag-on discovery flow. The name + title fields above keep
          their LEGACY positions; every poll-fed element (ramble growth, the
          feed past its 96px floor, the theme card mounting, the star ask
          resolving) sits BELOW them, so a late arrival never shifts the
          required name field mid-typing (the Task 6 regression). The ramble
          variant of StoryFraming replaces the legacy row in the same
          structural slot — its mount height is deterministic (mood row + 2-row
          ramble). Whole block is flag-gated so flag-off output stays
          byte-identical. */}
      {CREATE_DISCOVERY_FLAG && (
        <>
          {/* X17 B4 — the truncated summary row becomes the always-visible,
              dictation-first ramble bound to eventSummary; the mood row still
              renders above it inside StoryFraming. */}
          <StoryFraming
            ramble
            onRambleBlur={onRambleBlur}
            tone={form.tone}
            eventSummary={form.eventSummary}
            learningWords={form.learningWords}
            onToneChange={(v) => onChange('tone', v)}
            onSummaryChange={(v) => onChange('eventSummary', v)}
            onLearningWordsChange={(v) => onChange('learningWords', v)}
          />

          {/* X17 B1 — real perception findings cascade in as Geist data chips.
              A min-height floor holds whenever the feed renders. */}
          <DiscoveryFeed chips={discoveryChips ?? []} reserve={stripPhase === 'reading'} />

          {/* X17 B2 — the feed's finale: the perception theme as a tap-to-edit
              Excalifont card. Hidden entirely when perception found no theme. */}
          <ThemeCard themeLine={form.themeLine} onChange={(v) => onChange('themeLine', v)} />

          {/* X17.2 — the ONE cast surface: star ask + naming + avatar
              confirm live on the faces. Reserved height from first mount;
              sits below the name field, so it can never shift it. */}
          <CastRow
            bookId={bookId}
            roster={roster ?? []}
            pages={pages ?? []}
            questions={form.captureQuestions}
            castMode={form.castMode}
            starCharacterId={form.starCharacterId}
            childName={form.childName}
            recurringKidCount={starChildren.length}
            reading={stripPhase === 'reading'}
            ensembleAllowed={ENSEMBLE_BOOKS_FLAG}
            onPickStar={onPickStar}
            onPickEveryone={onPickEveryone}
            onQuestionsChange={(qs) => onChange('captureQuestions', qs)}
          />
        </>
      )}

      {/* Story framing — legacy (flag-off) slot: always renders when discovery
          is off. The mood row needs zero analysis, and a missing summary falls
          back to a quiet "add a note" button. Flag-on renders the ramble
          variant of this component in the block directly above. */}
      {!CREATE_DISCOVERY_FLAG && (
        <StoryFraming
          tone={form.tone}
          eventSummary={form.eventSummary}
          learningWords={form.learningWords}
          onToneChange={(v) => onChange('tone', v)}
          onSummaryChange={(v) => onChange('eventSummary', v)}
          onLearningWordsChange={(v) => onChange('learningWords', v)}
        />
      )}

      {/* Capture chips — space is reserved while the librarian reads, and the
          rows rise into that same box on arrival (no layout shift below).
          When reading ends with zero questions the box collapses gently. */}
      <AnimatePresence initial={false}>
        {(reserveChipSpace || hasChips) && (
          <motion.section
            exit={{ height: 0, opacity: 0, marginTop: -24 }}
            transition={{
              duration: reducedMotion ? 0 : 0.2,
              ease: 'easeOut',
            }}
            className="overflow-hidden"
            style={{ minHeight: reserveChipSpace ? 96 : undefined }}
          >
            {hasChips && (
              <div className={stripPhase === 'hidden' ? undefined : 'chips-enter'}>
                {/* Flag-off ONLY: flag-on the avatar confirm lives exclusively
                    in CastRow's ask slot (asked-exactly-once, never both).
                    Kept here so a flag rollback restores the legacy confirm. */}
                {!CREATE_DISCOVERY_FLAG && bookId && mainCharacterId && (
                  <AvatarMatchChip bookId={bookId} mainCharacterId={mainCharacterId} />
                )}
                <CaptureChips
                  questions={form.captureQuestions}
                  caps={form.castMode === 'ensemble' ? { naming: 4, total: 5 } : undefined}
                  onChange={(qs) => onChange('captureQuestions', qs)}
                />
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
      <style jsx global>{`
        .chips-enter > div > div {
          animation: chip-rise 300ms ease-out both;
        }
        .chips-enter > div > div:nth-child(2) {
          animation-delay: 60ms;
        }
        .chips-enter > div > div:nth-child(3) {
          animation-delay: 120ms;
        }
        @keyframes chip-rise {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .chips-enter > div > div {
            animation-name: chip-fade;
            animation-delay: 0ms;
          }
          @keyframes chip-fade {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
        }
      `}</style>

      {/* Art style */}
      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-600">{t('artStyleLabel')}</label>
        <ArtStyleStrip value={form.artStyle} onChange={(s) => onChange('artStyle', s)} />
      </section>

      {/* Review-first toggle — quiet / tertiary */}
      <section className="flex items-center justify-between">
        <label htmlFor="reviewFirst" className="text-sm text-gray-500">
          {t('reviewFirstLabel')}
        </label>
        <Switch
          id="reviewFirst"
          checked={form.reviewFirst}
          onCheckedChange={(v) => onChange('reviewFirst', v)}
        />
      </section>

      {/* Primary CTA — fixed to the bottom on mobile */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-black/5 bg-white/90 px-4 py-3 backdrop-blur">
        <button
          onClick={handleSubmitClick}
          disabled={isSubmitting}
          className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-full bg-coral px-6 py-3.5 font-playful text-lg text-white shadow-md transition-colors hover:bg-coral/90 disabled:opacity-70"
        >
          {isSubmitting ? (
            <>
              <Storydust variant="twinkle" size="inline" className="text-white" />
              {t('saving')}
            </>
          ) : (
            t('makeMyBook')
          )}
        </button>
      </div>
    </div>
  );
}

export default SetupSheet;
