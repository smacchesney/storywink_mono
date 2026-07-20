'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CaptureQuestion } from '@/components/create/setup/CaptureChips';
import type { RosterCharacterLike } from '@/components/create/setup/discovery-feed';
import { describeCharacter } from '@/components/create/setup/discovery-feed';
// SPARK4 is the shared spark shape; .wink-twinkle-star + the global
// reduced-motion block in globals.css do all the motion work.
import { SPARK4 } from '@/components/ui/storydust';
import {
  CAST_RESERVE_MIN_HEIGHT,
  EVERYONE_FLASH_MS,
  STAR_BURST_MS,
  castFaceSrc,
  castMembers,
  castPhase,
  displayStarId,
  memberDisplayName,
  memberNameOptions,
  needsName,
  starAskApplicable,
  starPickableIds,
  upsertNameAnswer,
  type CastPageLike,
} from './cast-row';

interface CandidateAvatar {
  id: string;
  displayName: string;
  kind: string;
  renditions: Array<{ status: string; portraitUrl: string | null }>;
}

interface CastRowProps {
  bookId?: string;
  roster: RosterCharacterLike[];
  pages: CastPageLike[];
  questions: CaptureQuestion[];
  castMode: 'star' | 'ensemble';
  starCharacterId: string | null;
  /** The sheet's childName field value — display-only star labeling (UX spec). */
  childName: string;
  recurringKidCount: number;
  /** True while the perception sweep is plausibly still reading. */
  reading: boolean;
  ensembleAllowed: boolean;
  onPickStar: (character: RosterCharacterLike) => void;
  onPickEveryone: () => void;
  onQuestionsChange: (questions: CaptureQuestion[]) => void;
}

// Star-pick burst geometry: three sparks staggered around the picked ring.
const BURST_SPARKS = [
  { cls: 'absolute -top-1.5 -right-1 h-3 w-3', delay: '0s' },
  { cls: 'absolute -bottom-1 -left-1.5 h-2.5 w-2.5', delay: '0.15s' },
  { cls: 'absolute top-1/2 -right-2.5 h-2 w-2', delay: '0.3s' },
] as const;

/**
 * X17.2 — the ONE cast surface: faces first, one ask at a time. Absorbs the
 * StarPicker text chips, every naming capture row, and the AvatarMatchChip.
 * Reserved height from first mount (CAST_RESERVE_MIN_HEIGHT = the anatomy
 * sum); the ask slot is a fixed 44px two-zone box — content left, at most
 * one quiet action right — so question ↔ input ↔ avatar-confirm ↔ flash
 * swaps never shift layout. The strip holds faces ONLY.
 */
export function CastRow({
  bookId,
  roster,
  pages,
  questions,
  castMode,
  starCharacterId,
  childName,
  recurringKidCount,
  reading,
  ensembleAllowed,
  onPickStar,
  onPickEveryone,
  onQuestionsChange,
}: CastRowProps) {
  const t = useTranslations('setup');
  const tc = useTranslations('characters');
  const playful = useLocale() === 'ja' ? 'font-japanese' : 'font-playful';

  const members = castMembers(roster);
  const phase = castPhase({ members, recurringKidCount, castMode, starCharacterId, reading });
  const starPickable = starPickableIds(members);
  const starId = displayStarId({ starCharacterId, castMode, members });
  const trimmedChildName = childName.trim();

  // One inline input at a time (Decision 4).
  const [activeCharacterId, setActiveCharacterId] = React.useState<string | null>(null);
  // Re-enter the star ask from the quiet "Change star" affordance.
  const [changingStar, setChangingStar] = React.useState(false);

  // 2s "Everyone's the star!" flash — the tap visibly did something. The nonce
  // restarts the window on a repeat Everyone tap (setEveryoneFlash(true) alone
  // is a no-op when already true, so the effect wouldn't re-fire); clearing the
  // flash on a face tap cancels the timer through this effect's cleanup (also
  // StrictMode-safe — the early return means no timer is armed while idle).
  const [everyoneFlash, setEveryoneFlash] = React.useState(false);
  const [flashNonce, setFlashNonce] = React.useState(0);
  React.useEffect(() => {
    if (!everyoneFlash) return;
    const timer = window.setTimeout(() => setEveryoneFlash(false), EVERYONE_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [everyoneFlash, flashNonce]);

  // One-shot twinkle burst on the picked star's ring. The global
  // prefers-reduced-motion block in globals.css freezes .wink-twinkle-star,
  // so reduced motion shows faint static sparks for one cycle — no JS branch.
  const [burstId, setBurstId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!burstId) return;
    const timer = window.setTimeout(() => setBurstId(null), STAR_BURST_MS);
    return () => window.clearTimeout(timer);
  }, [burstId]);

  // Avatar confirm (absorbed from AvatarMatchChip — same endpoints).
  const [candidate, setCandidate] = React.useState<CandidateAvatar | null>(null);
  const [avatarState, setAvatarState] = React.useState<'idle' | 'saving' | 'linked' | 'dismissed'>(
    'idle',
  );
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
      if (ready && !cancelled) setCandidate(ready);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (phase === 'hidden') return null;

  const askingStar = phase === 'star-ask' || changingStar;

  // Fallback-crop dedupe: one claim set per render, walked in member order
  // (UX review — two faces must never share an identical g_face crop while
  // an alternative photo exists).
  const usedFallbackAssets = new Set<string>();
  const faceSrcById = new Map(
    members.map((m) => [m.characterId, castFaceSrc(m, pages, usedFallbackAssets)] as const),
  );

  const starDisplayFor = (m: RosterCharacterLike) => ({
    isStar: m.characterId === starId,
    childName: trimmedChildName,
  });

  const commitName = (member: RosterCharacterLike, raw: string) => {
    setActiveCharacterId(null);
    const next = upsertNameAnswer(questions, member, raw, (d) =>
      t('memberNameQuestion', { descriptor: d }),
    );
    if (next !== questions) onQuestionsChange(next);
  };

  const handleFaceTap = (member: RosterCharacterLike) => {
    if (askingStar && starPickable.has(member.characterId)) {
      setChangingStar(false);
      setBurstId(member.characterId);
      onPickStar(member);
      return;
    }
    // Opening naming cancels any in-flight Everyone flash (state + timer, via
    // the effect cleanup) so a commit inside the 2s window can't flash the
    // remainder afterward.
    setEveryoneFlash(false);
    // Dimmed faces during the star ask fall through to naming — never a pick.
    setActiveCharacterId((prev) => (prev === member.characterId ? null : member.characterId));
  };

  const handleEveryone = () => {
    setChangingStar(false);
    setEveryoneFlash(true);
    setFlashNonce((n) => n + 1); // restart the 2s window on a repeat Everyone tap
    onPickEveryone();
  };

  const linkAvatar = async () => {
    if (!candidate || !bookId || !starCharacterId) return;
    setAvatarState('saving');
    try {
      const res = await fetch(`/api/book/${bookId}/avatar-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarId: candidate.id, characterId: starCharacterId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setAvatarState('linked');
    } catch {
      setAvatarState('idle');
    }
  };

  const showAvatarConfirm =
    !askingStar &&
    activeCharacterId === null &&
    !!candidate &&
    !!starCharacterId &&
    castMode === 'star' &&
    avatarState !== 'dismissed';
  const avatarConfirmOpen = showAvatarConfirm && avatarState !== 'linked';

  const activeMember = members.find((m) => m.characterId === activeCharacterId) ?? null;
  // Wrong-crop escape hatch: descriptor chain with the name stripped, so the
  // placeholder never parrots the value being edited.
  const activeDescriptor = activeMember ? describeCharacter({ ...activeMember, name: null }) : null;

  return (
    <section
      className="flex flex-col gap-2"
      style={{ minHeight: CAST_RESERVE_MIN_HEIGHT }}
      aria-live="polite"
    >
      <label className={cn('text-sm font-medium text-gray-600', playful)}>
        {t('castRowLabel')}
      </label>

      {/* Faces strip — FACES ONLY; constant 88px; the right-edge fade mask is
          the more-faces-off-screen affordance (pure CSS, background-agnostic;
          browsers without mask-image simply show no fade).

          overflow-x-auto makes overflow-y compute to auto, clipping to the
          padding box — that flat-cuts the ring-2 rings (2px), the star glyph
          (-top-0.5/-left-0.5, 2px), and the SPARK4 top spark (-top-1.5, 6px
          above the face box; leftmost on the first face). pt-2/pl-2 add 8px of
          interior room to contain those overhangs; -mt-2/-ml-2 cancel it so the
          box's OUTER geometry is unchanged (content stays put, faces still
          align with the label). VERTICAL arithmetic — external height must stay
          88px so CAST_RESERVE_MIN_HEIGHT (168 = 20 + 8 + 88 + 8 + 44) holds:
          content 84 (64 face + 4 gap + 16 name) + pt-2 8 + pb-1 4 = 96 border-
          box, minus mt -8 = 88 external. HORIZONTAL: pl-2 8 + ml -8 net 0. */}
      <div
        className={cn(
          '-mt-2 -ml-2 flex items-start gap-3 overflow-x-auto pt-2 pb-1 pl-2 [scrollbar-width:none]',
          '[mask-image:linear-gradient(to_right,black_calc(100%_-_24px),transparent)]',
        )}
      >
        {phase === 'reading'
          ? [0, 1, 2].map((i) => (
              <div key={i} className="flex w-16 shrink-0 flex-col items-center gap-1">
                <div className="h-16 w-16 animate-pulse rounded-full bg-gray-100" />
                <div className="h-4 w-10 animate-pulse rounded bg-gray-100" />
              </div>
            ))
          : members.map((m) => {
              const starDisplay = starDisplayFor(m);
              const isStar = starDisplay.isStar;
              const active = m.characterId === activeCharacterId;
              const name = memberDisplayName(m, questions, starDisplay);
              const unnamed = needsName(m, questions, starDisplay);
              const src = faceSrcById.get(m.characterId) ?? null;
              const dimmed = askingStar && !starPickable.has(m.characterId);
              return (
                <button
                  key={m.characterId}
                  type="button"
                  onClick={() => handleFaceTap(m)}
                  aria-pressed={askingStar ? isStar : active}
                  aria-label={
                    isStar
                      ? t('castStarAria', { name: name ?? describeCharacter(m) })
                      : unnamed
                        ? t('castNameBadge', { descriptor: describeCharacter(m) })
                        : (name ?? describeCharacter(m))
                  }
                  className={cn(
                    'flex w-16 shrink-0 flex-col items-center gap-1 transition-opacity',
                    dimmed && 'opacity-40',
                  )}
                >
                  <span
                    className={cn(
                      'relative block h-16 w-16 rounded-full ring-2 transition-shadow',
                      isStar || active ? 'ring-coral' : 'ring-black/10',
                    )}
                  >
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt="" className="h-16 w-16 rounded-full object-cover" />
                    ) : (
                      <span className="block h-16 w-16 rounded-full bg-coral/10" />
                    )}
                    {isStar && (
                      <Star
                        className="absolute -top-0.5 -left-0.5 h-3 w-3 fill-coral text-coral"
                        aria-hidden
                      />
                    )}
                    {!askingStar && unnamed && (
                      <span
                        aria-hidden
                        className="absolute top-0 right-0 h-2.5 w-2.5 rounded-full bg-coral ring-2 ring-white"
                      />
                    )}
                    {burstId === m.characterId && (
                      <span aria-hidden className="pointer-events-none absolute inset-0 text-coral">
                        {BURST_SPARKS.map((s, i) => (
                          <svg
                            key={i}
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className={cn('wink-twinkle-star', s.cls)}
                            style={{ animationDelay: s.delay }}
                          >
                            <path d={SPARK4} />
                          </svg>
                        ))}
                      </span>
                    )}
                  </span>
                  {/* Always-reserved name line — height never changes. */}
                  <span className="h-4 max-w-[64px] truncate text-xs text-gray-600">
                    {name ?? ' '}
                  </span>
                </button>
              );
            })}
      </div>

      {/* Ask slot — fixed 44px, two zones: content left, one quiet action right. */}
      <div className="flex h-11 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {phase === 'reading' ? (
            <p className={cn('text-working-shimmer text-sm text-gray-500', playful)}>
              {t('castReading')}
            </p>
          ) : activeMember ? (
            <>
              <input
                // Remount per character: defaultValue and autoFocus apply on
                // mount only, so switching faces without the key would carry
                // the previous face's text into the new input.
                key={activeMember.characterId}
                autoFocus
                type="text"
                // Committed names only — the star face's display-only
                // childName never pre-fills the input (not a committed row).
                defaultValue={memberDisplayName(activeMember, questions) ?? ''}
                maxLength={50}
                placeholder={activeDescriptor ?? ''}
                aria-label={t('castNameHelper', { descriptor: activeDescriptor ?? '' })}
                onBlur={(e) => commitName(activeMember, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                  if (e.key === 'Escape') setActiveCharacterId(null);
                }}
                className={cn(
                  'h-9 w-36 shrink-0 rounded-full border border-coral bg-white px-3 text-sm text-gray-800 focus:ring-1 focus:ring-coral focus:outline-none',
                  playful,
                )}
              />
              <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                {memberNameOptions(activeMember, questions).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onMouseDown={(e) => e.preventDefault() /* keep input from blurring first */}
                    onClick={() => commitName(activeMember, opt)}
                    className={cn(
                      'shrink-0 rounded-full border border-black/10 bg-white px-3 py-1 text-sm text-gray-700 hover:border-coral/50',
                      playful,
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </>
          ) : everyoneFlash ? (
            <p className={cn('text-sm text-coral', playful)}>{t('castEveryoneConfirm')}</p>
          ) : askingStar ? (
            <p className={cn('text-sm text-gray-700', playful)}>
              {trimmedChildName
                ? t('castStarWhich', { childName: trimmedChildName })
                : t('starLabel')}
            </p>
          ) : avatarConfirmOpen ? (
            <>
              {candidate!.renditions.find((r) => r.portraitUrl)?.portraitUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={candidate!.renditions.find((r) => r.portraitUrl)!.portraitUrl!}
                  alt=""
                  className="h-6 w-6 shrink-0 rounded-full border border-white object-cover shadow-sm"
                />
              )}
              <p className={cn('min-w-0 flex-1 truncate text-sm text-gray-700', playful)}>
                {tc('matchQuestion', { name: candidate!.displayName })}
              </p>
              <button
                type="button"
                disabled={avatarState === 'saving'}
                onClick={linkAvatar}
                className={cn(
                  'shrink-0 rounded-full border border-coral bg-coral px-3 py-1 text-sm text-white hover:bg-coral/90 disabled:opacity-60',
                  playful,
                )}
              >
                {tc('matchYes')}
              </button>
              <button
                type="button"
                onClick={() => setAvatarState('dismissed')}
                className={cn(
                  'shrink-0 px-2 py-1 text-sm text-gray-400 hover:text-gray-600',
                  playful,
                )}
              >
                {tc('matchNo')}
              </button>
            </>
          ) : showAvatarConfirm && avatarState === 'linked' ? (
            <p className={cn('text-sm text-gray-600', playful)}>
              {tc('matchLinked', { name: candidate!.displayName })}
            </p>
          ) : (
            <p className={cn('text-sm text-gray-500', playful)}>{t('castNamePrompt')}</p>
          )}
        </div>

        {/* Right zone — at most one quiet action; none while an input is open. */}
        {!activeMember &&
          !everyoneFlash &&
          askingStar &&
          ensembleAllowed &&
          recurringKidCount >= 2 && (
            <button
              type="button"
              aria-pressed={castMode === 'ensemble'}
              onClick={handleEveryone}
              className={cn(
                'h-9 shrink-0 rounded-full border-2 px-4 text-sm transition-colors',
                playful,
                castMode === 'ensemble'
                  ? 'border-coral bg-coral text-white'
                  : 'border-coral bg-white text-coral hover:bg-coral/10',
              )}
            >
              {t('starEveryone')}
            </button>
          )}
        {!activeMember &&
          !everyoneFlash &&
          !askingStar &&
          phase === 'naming' &&
          !avatarConfirmOpen &&
          starAskApplicable(recurringKidCount) && (
            <button
              type="button"
              onClick={() => setChangingStar(true)}
              className="h-9 shrink-0 px-2 text-sm text-gray-400 hover:text-gray-600"
            >
              {t('castChange')}
            </button>
          )}
      </div>
    </section>
  );
}

export default CastRow;
