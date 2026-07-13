'use client';

/**
 * X8 create chooser: the two-way fork on /create when NEXT_PUBLIC_AVATARS_ENABLED
 * is on. Card A (coral-forward, the default) runs the fast photos → book path;
 * Card B runs photos → characters → stories and personalizes to the account's
 * cast. Both cards open with the SAME PhotoGlyph — "same start, different
 * outcome" is the fork's whole legibility, so beat 1 must never diverge.
 *
 * One /api/avatars snapshot drives everything on Card B (title, beat-2 art,
 * destination, telemetry): title and face pile never disagree with where the
 * tap actually goes. The chooser never auto-navigates and never lands on bare
 * /characters.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Pencil, Sparkles } from 'lucide-react';
import type { AvatarSummary } from '@/components/characters/AvatarCard';
import { Storydust } from '@/components/ui/storydust';
import {
  characterPathDestination,
  isUsableAvatar,
  pickStar,
  type CharacterPathDestination,
} from '@/lib/characterPathDestination';
import { rememberCreatePath, readCreatePath, type CreatePath } from '@/lib/createPath';
import { track } from '@/lib/track';
import { cn } from '@/lib/utils';

/** Cloudinary delivery base — same cloud ("storywink") as lib/mascots.ts. */
const CLOUDINARY_BASE = 'https://res.cloudinary.com/storywink/image/upload';

/**
 * Card B's generic beat-2 art: a fully synthetic waving-character cutout, no
 * real person. This is the "Child in yellow coat" avatar minted by the X7 E2E
 * run — AI-generated from AI-generated book art — so it is safe to ship as
 * decorative sample art on a public surface.
 * Public id: storywink/avatars/cmrhlwoxl003g6dbhhbr5arle/cutout_vignette_t.png
 */
const SYNTHETIC_CUTOUT_URL = `${CLOUDINARY_BASE}/storywink/avatars/cmrhlwoxl003g6dbhhbr5arle/cutout_vignette_t.png`;

const KIND_EMOJI: Record<AvatarSummary['kind'], string> = {
  CHILD: '🧒',
  ADULT: '🧑',
  PET: '🐾',
  TOY: '🧸',
};

/** The single source of truth for Card B — one fetch, one shape, no mixing. */
type Snapshot =
  | { phase: 'pending' }
  | { phase: 'resolved'; avatars: AvatarSummary[] }
  | { phase: 'unavailable' };

/** hadCharacters for honest telemetry — null until the snapshot resolves. */
function hadCharactersOf(snapshot: Snapshot): boolean | null {
  return snapshot.phase === 'resolved'
    ? characterPathDestination(snapshot.avatars) === '/create/characters'
    : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---- Shared beat art (CSS/inline only — no remote assets) ---------------- */

/**
 * The shared opening beat: 2-3 tilted photo thumbnails. Rendered IDENTICALLY
 * by both cards' beat 1 — do not vary it, it is what makes the two paths read
 * as one shared start.
 */
function PhotoGlyph() {
  return (
    <span aria-hidden className="relative block h-14 w-16">
      <span className="absolute left-1 top-3 h-10 w-8 -rotate-12 rounded-lg border-2 border-white bg-[#FFE1D6] shadow-sm" />
      <span className="absolute right-1 top-3 h-10 w-8 rotate-12 rounded-lg border-2 border-white bg-[#FFEDE7] shadow-sm" />
      <span className="absolute left-1/2 top-1 h-11 w-8 -translate-x-1/2 rounded-lg border-2 border-white bg-[#FFF3EC] shadow" />
    </span>
  );
}

/** Card A beat 2: "we write & draw" — a coral pencil with a sparkle. */
function SparklePencilGlyph() {
  return (
    <span aria-hidden className="relative flex h-14 w-14 items-center justify-center">
      <Pencil className="h-8 w-8 text-coral" strokeWidth={2} />
      <Sparkles className="absolute right-0 top-1 h-4 w-4 text-[#FFB020]" strokeWidth={2} />
    </span>
  );
}

/** Card A beat 3: one keepsake book (coral spine edge). */
function BookCoverGlyph() {
  return (
    <span aria-hidden className="relative block h-14 w-11">
      <span className="absolute inset-0 rounded-md rounded-l-sm border-2 border-coral/25 bg-[#FFF3EC] shadow-sm" />
      <span className="absolute inset-y-0 left-0 w-1.5 rounded-l-sm bg-coral" />
    </span>
  );
}

/** Card B beat 3: a fanned stack of little books — "story after story". */
function BookStackGlyph() {
  return (
    <span aria-hidden className="relative block h-14 w-16">
      <span className="absolute left-1/2 top-2.5 h-10 w-8 -translate-x-1/2 -rotate-12 rounded-md border-2 border-black/10 bg-[#EAF2FF] shadow-sm" />
      <span className="absolute left-1/2 top-2 h-10 w-8 -translate-x-1/2 rotate-12 rounded-md border-2 border-black/10 bg-[#FFF0E6] shadow-sm" />
      <span className="absolute left-1/2 top-1 h-11 w-8 -translate-x-1/2 rounded-md rounded-l-sm border-2 border-coral/25 bg-white shadow">
        <span className="absolute inset-y-0 left-0 w-1.5 rounded-l-sm bg-coral/70" />
      </span>
    </span>
  );
}

/** Card B beat 2 personalized: up to 4 usable avatars, overlapping. */
function FacePile({ avatars }: { avatars: AvatarSummary[] }) {
  const faces = avatars.filter(isUsableAvatar).slice(0, 4);
  return (
    <span className="flex -space-x-3">
      {faces.map((a) => {
        const portrait = a.renditions.find((r) => r.portraitUrl)?.portraitUrl;
        return portrait ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={a.id}
            src={portrait}
            alt=""
            className="h-7 w-7 rounded-full border-2 border-white bg-[#FFF9F5] object-cover shadow-sm"
          />
        ) : (
          <span
            key={a.id}
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#FFF9F5] text-sm shadow-sm"
          >
            {KIND_EMOJI[a.kind]}
          </span>
        );
      })}
    </span>
  );
}

/* ---- Journey strip -------------------------------------------------------- */

interface Beat {
  art: ReactNode;
  label: string;
}

/**
 * The 3-beat strip: art (height fixed at h-16 so no beat can reflow the card)
 * over a static one-line label, with aria-hidden arrows between.
 */
function JourneyStrip({ beats }: { beats: Beat[] }) {
  return (
    <div className="flex items-start justify-between gap-1">
      {beats.map((beat, i) => (
        <React.Fragment key={i}>
          <div className="flex flex-1 flex-col items-center gap-2">
            <span className="flex h-16 items-center justify-center">{beat.art}</span>
            <span className="text-center text-xs leading-tight text-gray-600">{beat.label}</span>
          </div>
          {i < beats.length - 1 && (
            <ArrowRight aria-hidden className="mt-6 h-4 w-4 shrink-0 text-gray-300" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ---- Card shell (motion + tap target + emphasis/ring) -------------------- */

interface CardShellProps {
  onClick: () => void;
  emphasis: 'primary' | 'quiet';
  ringed: boolean;
  prefersReduced: boolean;
  /** Announced while the card is resolving its destination (the pending hold). */
  busy?: boolean;
  children: ReactNode;
}

function CardShell({ onClick, emphasis, ringed, prefersReduced, busy, children }: CardShellProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-busy={busy || undefined}
      whileHover={prefersReduced ? undefined : { y: -4, scale: 1.01 }}
      whileTap={prefersReduced ? undefined : { scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className={cn(
        'flex h-full w-full flex-col rounded-2xl border-2 px-5 py-5 text-left transition-colors',
        emphasis === 'primary' ? 'bg-[#FFF9F5] shadow-md' : 'bg-white shadow-sm',
        ringed
          ? 'border-coral/50 ring-2 ring-coral/20'
          : emphasis === 'primary'
            ? 'border-coral/40'
            : 'border-black/10',
      )}
    >
      {children}
    </motion.button>
  );
}

const CARD_TITLE_CLASS = 'font-playful text-lg font-semibold leading-tight text-[#1a1a1a]';
const CHIP_CLASS =
  'inline-flex max-w-full items-center self-start rounded-full border border-coral/30 bg-white px-3 py-1 text-xs leading-snug text-gray-600';

function LastTime({ children }: { children: ReactNode }) {
  return <span className="mt-2 text-xs font-medium text-coral">{children}</span>;
}

/* ---- The chooser ---------------------------------------------------------- */

export function CreatePathChooser() {
  const router = useRouter();
  const t = useTranslations('create');
  const prefersReduced = useReducedMotion() ?? false;

  const [snapshot, setSnapshot] = useState<Snapshot>({ phase: 'pending' });
  // The race read: keep the latest snapshot in a ref so a tap fired mid-fetch
  // can pick up a resolution that lands during its short hold.
  const snapshotRef = useRef<Snapshot>(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const [lastPath, setLastPath] = useState<CreatePath | null>(null);
  const [busyCardB, setBusyCardB] = useState(false);
  // Synchronous double-tap guard — a second tap must lose the race with the
  // first's async hold, so this can't wait for a state commit.
  const navigatingRef = useRef(false);
  // Unmount guard for the pending-hold loop — mirrors the fetch effect's
  // cancelled flag so router.push can't fire after the chooser is gone.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // One snapshot on mount (the flag is known-on here).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/avatars');
        if (cancelled) return;
        if (!res.ok) {
          setSnapshot({ phase: 'unavailable' });
          return;
        }
        const data = (await res.json()) as { avatars?: AvatarSummary[] };
        if (cancelled) return;
        setSnapshot({ phase: 'resolved', avatars: data.avatars ?? [] });
      } catch {
        if (!cancelled) setSnapshot({ phase: 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Remembered path — read after mount to avoid a hydration mismatch.
  useEffect(() => {
    setLastPath(readCreatePath());
  }, []);

  const resolved = snapshot.phase === 'resolved' ? snapshot.avatars : null;
  const star = resolved ? pickStar(resolved) : null;
  const personalized = star !== null;
  const revealKey: 'pending' | 'generic' | 'named' =
    snapshot.phase === 'pending' ? 'pending' : personalized ? 'named' : 'generic';

  const choosePhotos = useCallback(() => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    rememberCreatePath('photos');
    track('create_path_chosen', {
      props: { path: 'photos', hadCharacters: hadCharactersOf(snapshotRef.current) },
    });
    router.push('/create/photos');
  }, [router]);

  const goAvatars = useCallback(
    (dest: CharacterPathDestination) => {
      rememberCreatePath('avatars');
      track('create_path_chosen', {
        props: { path: 'avatars', hadCharacters: hadCharactersOf(snapshotRef.current) },
      });
      router.push(dest);
    },
    [router],
  );

  const chooseAvatars = useCallback(async () => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;

    const now = snapshotRef.current;
    if (now.phase === 'resolved') {
      goAvatars(characterPathDestination(now.avatars));
      return;
    }
    if (now.phase === 'unavailable') {
      goAvatars('/characters?add=1');
      return;
    }

    // Pending: hold ~300ms behind an inline twinkle, navigating early if the
    // snapshot resolves during the hold; still pending after → the studio.
    setBusyCardB(true);
    const deadline = Date.now() + 300;
    while (Date.now() < deadline && snapshotRef.current.phase === 'pending') {
      await sleep(50);
    }
    if (!mountedRef.current) return;
    const after = snapshotRef.current;
    goAvatars(after.phase === 'resolved' ? characterPathDestination(after.avatars) : '/characters?add=1');
  }, [goAvatars]);

  // Card B beat-2 art: one fixed box (h-16 w-20) shared by all three states,
  // crossfading on the single snapshot so the card never changes height.
  const beatTwoContent =
    revealKey === 'named' && resolved ? (
      <FacePile avatars={resolved} />
    ) : revealKey === 'pending' ? (
      // motion-safe keeps the class identical between SSR and hydration
      // (useReducedMotion resolves differently on the server and would
      // mismatch) while still honoring reduce-motion, in CSS.
      <span aria-hidden className="h-12 w-12 rounded-2xl bg-black/5 motion-safe:animate-pulse" />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={SYNTHETIC_CUTOUT_URL} alt="" className="h-16 w-full object-contain" />
    );

  const beatTwoArt = (
    <span className="relative flex h-16 w-20 items-center justify-center">
      <AnimatePresence initial={false}>
        <motion.span
          key={revealKey}
          className="absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefersReduced ? 0 : 0.25 }}
        >
          {beatTwoContent}
        </motion.span>
      </AnimatePresence>
    </span>
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 md:max-w-3xl">
      <h1 className="mb-6 text-center font-playful text-2xl font-bold text-[#1a1a1a] md:text-3xl">
        {t('startCreating')}
      </h1>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Card A — photos → book (the default, coral-forward) */}
        <CardShell
          onClick={choosePhotos}
          emphasis="primary"
          ringed={lastPath === 'photos'}
          prefersReduced={prefersReduced}
        >
          <JourneyStrip
            beats={[
              { art: <PhotoGlyph />, label: t('pathPhotosBeat1') },
              { art: <SparklePencilGlyph />, label: t('pathPhotosBeat2') },
              { art: <BookCoverGlyph />, label: t('pathPhotosBeat3') },
            ]}
          />
          <span className={cn(CARD_TITLE_CLASS, 'mt-4 block')}>{t('pathPhotosTitle')}</span>
          <span className={cn(CHIP_CLASS, 'mt-3')}>{t('pathPhotosChip')}</span>
          {lastPath === 'photos' && <LastTime>{t('pathLastTime')}</LastTime>}
        </CardShell>

        {/* Card B — photos → characters → stories (personalizes to the cast) */}
        <CardShell
          onClick={() => {
            void chooseAvatars();
          }}
          emphasis="quiet"
          ringed={lastPath === 'avatars'}
          prefersReduced={prefersReduced}
          busy={busyCardB}
        >
          <JourneyStrip
            beats={[
              { art: <PhotoGlyph />, label: t('pathFriendsBeat1') },
              { art: beatTwoArt, label: t('pathFriendsBeat2') },
              { art: <BookStackGlyph />, label: t('pathFriendsBeat3') },
            ]}
          />
          <div className="relative mt-4 min-h-[1.75rem]">
            <AnimatePresence mode="wait" initial={false}>
              {/* One line in BOTH variants (truncate) so the generic→named swap
                  can never change the line count — extreme names ellipsize. */}
              <motion.span
                key={revealKey === 'named' ? 'named' : 'generic'}
                className={cn(CARD_TITLE_CLASS, 'block max-w-full truncate')}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: prefersReduced ? 0 : 0.22 }}
              >
                {revealKey === 'named' && star
                  ? t('pathFriendsTitleNamed', { name: star.displayName })
                  : t('pathFriendsTitle')}
              </motion.span>
            </AnimatePresence>
          </div>
          {busyCardB ? (
            // Same box as the chip (border/padding preserved, just transparent)
            // so swapping in the twinkle can't change the card's height.
            <span className={cn(CHIP_CLASS, 'mt-3 justify-center border-transparent bg-transparent')}>
              <Storydust variant="twinkle" size="inline" />
            </span>
          ) : (
            <span className={cn(CHIP_CLASS, 'mt-3')}>{t('pathFriendsChip')}</span>
          )}
          {lastPath === 'avatars' && <LastTime>{t('pathLastTime')}</LastTime>}
        </CardShell>
      </div>
    </div>
  );
}

export default CreatePathChooser;
