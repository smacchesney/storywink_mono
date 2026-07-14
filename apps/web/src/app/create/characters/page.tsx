'use client';

/**
 * X6d avatar-first story flow: cast → spark → length, then straight into the
 * standard generation wait (the setup page renders GenerationProgress for
 * GENERATING books — no new wait UI). Art style is invisible when the cast
 * shares exactly one drawn style, a small picker when they share several,
 * and a one-tap repair when they share none. Dark behind
 * NEXT_PUBLIC_AVATARS_ENABLED (404 like every avatar surface).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { notFound, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Check, Pencil, Plus } from 'lucide-react';
import { Storydust } from '@/components/ui/storydust';
import { optimizeCloudinaryUrl } from '@storywink/shared';
import { STYLE_LIBRARY, StyleKey, getStylePreviewUrl } from '@storywink/shared/prompts/styles';
import type { AvatarSummary } from '@/components/characters/AvatarCard';
import {
  AVATAR_STORY_PAGE_LENGTHS,
  AvatarStoryPageLength,
  castComposition,
  sharedReadyStyles,
  autoSelectAfterCreate,
  nextArrivalPollStart,
  CastKind,
} from '@/lib/avatar-story';
import { castTileState, isUsableAvatar } from '@/lib/characterPathDestination';
import { styleLabelKey } from '@/lib/styleLabelKey';
import { rememberCreatePath } from '@/lib/createPath';
import {
  helperStepEnabled,
  avatarStorySteps,
  stepIndexOf,
  prevStep,
  storyProposalSignature,
  type AvatarStoryStep,
} from '@/lib/story-helper';
import { track } from '@/lib/track';
import logger from '@/lib/logger';

// B2: dynamic + ssr:false keeps the PhotoTray/detect stack out of the wizard's
// first-load bundle — the studio only mounts when the parent taps "+ Add".
const AvatarStudioDialog = dynamic(() => import('@/components/characters/AvatarStudioDialog'), {
  ssr: false,
});

const KIND_EMOJI: Record<CastKind, string> = {
  CHILD: '🧒',
  ADULT: '🧑',
  PET: '🐾',
  TOY: '🧸',
};

const SPARK_KEYS = [
  'sparkRainy',
  'sparkPicnic',
  'sparkFort',
  'sparkMoon',
  'sparkSock',
  'sparkDragon',
] as const;

// The "More ideas" pool: trim, drop blanks, drop duplicates, keep order.
function dedupeNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

type Step = AvatarStoryStep;

// D7: client step gate, default OFF. Baked at build time (Dockerfile ARG +
// turbo env allowlist), so this is a constant — the whole "Shape the story"
// path is byte-identically absent when it is false.
const STORY_HELPER_FLAG = process.env.NEXT_PUBLIC_STORY_HELPER_ENABLED === 'true';

export default function AvatarStoryPage() {
  if (process.env.NEXT_PUBLIC_AVATARS_ENABLED !== 'true') notFound();
  return <AvatarStoryFlow />;
}

function AvatarStoryFlow() {
  const router = useRouter();
  const t = useTranslations('avatarStories');
  const tSetup = useTranslations('setup');
  const tCharacters = useTranslations('characters');
  const locale = useLocale();

  const [avatars, setAvatars] = useState<AvatarSummary[] | null>(null);
  const [loadTrouble, setLoadTrouble] = useState(false);
  const [step, setStep] = useState<Step>('cast');
  const [castIds, setCastIds] = useState<string[]>([]);
  const [studioOpen, setStudioOpen] = useState(false);
  // Tiles that just flipped drawing→selectable pop once (B4). Under
  // motion-reduce the animate-in classes drop out and the flip is instant.
  const [poppedIds, setPoppedIds] = useState<Set<string>>(new Set());
  const [language, setLanguage] = useState<'en' | 'ja'>(locale === 'ja' ? 'ja' : 'en');
  const [sparkKey, setSparkKey] = useState<string | null>(null);
  const [customSpark, setCustomSpark] = useState('');
  const [writingOwn, setWritingOwn] = useState(false);
  // D1/D4 story helper. `proposalOptions` is the deduped pool the "More ideas"
  // button cycles ([storyline, ...alternates]); `acceptedStoryline` is the
  // accepted/edited text that REPLACES the premise at create() ('' = not
  // accepted, so the raw premise proceeds — skip and every fail-open path).
  const [proposalOptions, setProposalOptions] = useState<string[] | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [optionIndex, setOptionIndex] = useState(0);
  const [shapeText, setShapeText] = useState('');
  const [shapeEditing, setShapeEditing] = useState(false);
  const [shapeEdited, setShapeEdited] = useState(false);
  const [acceptedStoryline, setAcceptedStoryline] = useState('');
  const [pageLength, setPageLength] = useState<AvatarStoryPageLength>(12);
  const [artStyle, setArtStyle] = useState<StyleKey | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairTrouble, setRepairTrouble] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // When the current live-arrival polling session began. Held in a ref because
  // the poll effect re-runs on every avatars change, so a local start time would
  // reset each cycle and never reach the 240s cap. Null while nothing is drawing.
  const arrivalPollStartRef = useRef<number | null>(null);
  // The drawing-avatar ids the poll effect saw last run. A NEW id restamps the
  // 240s clock (nextArrivalPollStart) so one wedged rendition never starves a
  // character the parent creates after the cap has expired.
  const arrivalPollDrawingIdsRef = useRef<ReadonlySet<string>>(new Set());
  // B4 auto-select bookkeeping. `preStudioIdsRef` snapshots the shelf before
  // the studio opens; the diff after `onCreated` is exactly the characters made
  // this session. Those ids wait in `pendingAutoSelectRef` until their drawing
  // lands, then get cap-guarded into the cast once (evaluated then dropped).
  const preStudioIdsRef = useRef<Set<string>>(new Set());
  const pendingAutoSelectRef = useRef<Set<string>>(new Set());
  const collectCreatedRef = useRef(false);
  // Latest cast ids, read by the auto-select effect without re-subscribing it to
  // every selection change (it fires on avatar arrivals only).
  const castIdsRef = useRef<string[]>([]);
  // Ids that were drawing on the previous avatars snapshot — used to detect the
  // drawing→selectable flip for both the pop and the auto-select.
  const prevDrawingIdsRef = useRef<Set<string>>(new Set());
  // If create succeeded but the story enqueue did not, retry must reuse the
  // SAME book — never mint a duplicate.
  const createdBookIdRef = useRef<string | null>(null);
  // ...but ONLY while the choices are unchanged: if the parent goes Back and
  // edits the cast, spark, length, style, or language, the half-created book
  // no longer matches — forget it (the draft-retention sweep reaps the
  // orphan) rather than generate a story from stale choices.
  useEffect(() => {
    createdBookIdRef.current = null;
  }, [
    castIds,
    sparkKey,
    customSpark,
    writingOwn,
    pageLength,
    artStyle,
    language,
    acceptedStoryline,
  ]);

  // Story-helper async plumbing (D2/D6). The prefetch's abort controller, the
  // signature the cached proposal belongs to, whether the one exhaustion
  // re-call has fired, whether story_helper_shown has fired for this proposal,
  // and a step mirror so the 6s fail-open only advances when still on shape.
  const proposalAbortRef = useRef<AbortController | null>(null);
  const proposalSigRef = useRef<string | null>(null);
  const proposalRecalledRef = useRef(false);
  const shownFiredRef = useRef(false);
  const stepRef = useRef<Step>('cast');
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const load = useCallback(async () => {
    const res = await fetch('/api/avatars').catch(() => null);
    if (!res?.ok) {
      setLoadTrouble(true);
      return;
    }
    setLoadTrouble(false);
    const data = (await res.json()) as { avatars: AvatarSummary[] };
    // B3: keep usable avatars AND in-flight ones (a drawing still PENDING) so a
    // character created here shows up straight away as a "Drawing…" tile —
    // selectability still gates on isUsableAvatar below.
    setAvatars(
      data.avatars.filter(
        (a) => isUsableAvatar(a) || a.renditions.some((r) => r.status === 'PENDING'),
      ),
    );
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  // Prune phantom cast ids (deleted / no-longer-READY avatars restored from
  // a stale draft): an invisible id would 404 create in a retry loop the
  // parent cannot see or fix.
  useEffect(() => {
    if (!avatars) return;
    setCastIds((prev) => {
      const pruned = prev.filter((id) => avatars.some((a) => a.id === id));
      return pruned.length === prev.length ? prev : pruned;
    });
  }, [avatars]);

  // Wizard state survives an accidental browser-back / reload within the
  // session — three steps of picking must never evaporate.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = sessionStorage.getItem('storywink-avatar-story-draft');
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        step?: Step;
        castIds?: string[];
        sparkKey?: string | null;
        customSpark?: string;
        writingOwn?: boolean;
        acceptedStoryline?: string;
        pageLength?: AvatarStoryPageLength;
        language?: 'en' | 'ja';
      };
      if (draft.castIds?.length) setCastIds(draft.castIds);
      if (draft.sparkKey) setSparkKey(draft.sparkKey);
      if (draft.customSpark) setCustomSpark(draft.customSpark);
      if (draft.writingOwn) setWritingOwn(true);
      // The accepted/edited storyline survives a reload; the live proposal does
      // not, so a mid-shape reload lands on spark (re-tapping Next re-prefetches).
      if (draft.acceptedStoryline) {
        setAcceptedStoryline(draft.acceptedStoryline);
        setShapeText(draft.acceptedStoryline);
      }
      if (
        draft.pageLength &&
        (AVATAR_STORY_PAGE_LENGTHS as readonly number[]).includes(draft.pageLength)
      ) {
        setPageLength(draft.pageLength);
      }
      if (draft.language === 'en' || draft.language === 'ja') setLanguage(draft.language);
      if (draft.step === 'length') setStep('length');
      else if (draft.step === 'spark' || draft.step === 'shape') setStep('spark');
    } catch {
      /* storage unavailable or stale shape — start fresh */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        'storywink-avatar-story-draft',
        JSON.stringify({
          step,
          castIds,
          sparkKey,
          customSpark,
          writingOwn,
          acceptedStoryline,
          pageLength,
          language,
        }),
      );
    } catch {
      /* storage unavailable — drafting is best-effort */
    }
  }, [step, castIds, sparkKey, customSpark, writingOwn, acceptedStoryline, pageLength, language]);

  // Keep the ref mirror current so the avatar-arrival effects read the latest
  // cast without re-firing on every selection.
  useEffect(() => {
    castIdsRef.current = castIds;
  }, [castIds]);

  // After the studio's onCreated, the ids present now but absent from the
  // pre-open snapshot are the characters this session made — queue them for
  // auto-select once their drawing lands.
  useEffect(() => {
    if (!avatars || !collectCreatedRef.current) return;
    collectCreatedRef.current = false;
    for (const a of avatars) {
      if (!preStudioIdsRef.current.has(a.id)) pendingAutoSelectRef.current.add(a.id);
    }
  }, [avatars]);

  // As queued characters flip usable, cap-guard them into the cast (B4). Each
  // id is evaluated exactly once; a capped add is dropped silently so the tile
  // just pops to selectable and the parent chooses. Only on the cast step: the
  // repair poll's setAvatars must never silently mutate a cast the parent has
  // already advanced past (which would also reset createdBookIdRef).
  useEffect(() => {
    if (step !== 'cast' || !avatars) return;
    const pending = pendingAutoSelectRef.current;
    if (pending.size === 0) return;
    let nextIds = castIdsRef.current;
    const done: string[] = [];
    for (const id of Array.from(pending)) {
      const a = avatars.find((av) => av.id === id);
      if (!a) {
        done.push(id); // deleted before it settled — stop tracking it
        continue;
      }
      if (castTileState(a) !== 'selectable') continue; // still drawing — wait
      // Rebuild the cast per iteration so a second character settling in the
      // same tick weighs the first one's add — autoSelectAfterCreate recomputes
      // the resulting composition from currentCast, enforcing ≥1 person / caps.
      const currentCast = nextIds
        .map((cid) => avatars.find((av) => av.id === cid))
        .filter((av): av is AvatarSummary => Boolean(av));
      if (autoSelectAfterCreate(currentCast, a)) nextIds = [...nextIds, id];
      done.push(id);
    }
    for (const id of done) pending.delete(id);
    if (nextIds !== castIdsRef.current) setCastIds(nextIds);
  }, [step, avatars]);

  // A tile that was drawing and is now selectable pops once (B4).
  useEffect(() => {
    if (!avatars) return;
    const drawingNow = new Set<string>();
    const flipped: string[] = [];
    for (const a of avatars) {
      if (castTileState(a) === 'drawing') drawingNow.add(a.id);
      else if (prevDrawingIdsRef.current.has(a.id)) flipped.push(a.id);
    }
    prevDrawingIdsRef.current = drawingNow;
    if (flipped.length) {
      setPoppedIds((prev) => {
        const next = new Set(prev);
        for (const id of flipped) next.add(id);
        return next;
      });
    }
  }, [avatars]);

  // B3 live-arrival poll: every 4s while a character is drawing, but only on the
  // cast step. Capped at 240s like the repair poll — past four minutes a
  // rendition is wedged, so stop polling (the "drawing…" tiles may go stale,
  // which is acceptable). The cap is keyed to the SET of drawing ids via
  // nextArrivalPollStart: a NEW drawing restamps the clock (a wedged avatar
  // must not starve a later creation), every drawing settling resets it, the
  // same set continuing keeps it so the cap can expire. Leaving the step also
  // resets; unmounting tears the interval down via cleanup.
  useEffect(() => {
    const drawingIds: ReadonlySet<string> = new Set(
      (avatars ?? [])
        .filter((a) => a.renditions.some((r) => r.status === 'PENDING'))
        .map((a) => a.id),
    );
    if (step !== 'cast') {
      arrivalPollStartRef.current = null;
      arrivalPollDrawingIdsRef.current = drawingIds;
      return;
    }
    const startedAt = nextArrivalPollStart(
      arrivalPollDrawingIdsRef.current,
      drawingIds,
      arrivalPollStartRef.current,
      Date.now(),
    );
    arrivalPollStartRef.current = startedAt;
    arrivalPollDrawingIdsRef.current = drawingIds;
    if (startedAt === null || Date.now() - startedAt > 240_000) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [step, avatars, load]);

  const openStudio = useCallback(() => {
    preStudioIdsRef.current = new Set((avatars ?? []).map((a) => a.id));
    setStudioOpen(true);
  }, [avatars]);

  const cast = useMemo(
    () =>
      castIds
        .map((id) => avatars?.find((a) => a.id === id))
        .filter((a): a is AvatarSummary => Boolean(a)),
    [castIds, avatars],
  );
  const composition = castComposition(cast.map((a) => a.kind));
  const peopleFull = composition.people >= 4;
  const companionsFull = composition.companions >= 2;

  const sharedStyles = useMemo(
    () => sharedReadyStyles(cast).filter((s): s is StyleKey => s in STYLE_LIBRARY),
    [cast],
  );

  // Style resolves itself whenever the cast (or shared set) changes: exactly
  // one shared style → invisible; several → keep/repair the current pick.
  useEffect(() => {
    if (sharedStyles.length === 0) {
      setArtStyle(null);
    } else if (!artStyle || !sharedStyles.includes(artStyle)) {
      setArtStyle(sharedStyles[0]);
    }
  }, [sharedStyles, artStyle]);

  const premise = writingOwn ? customSpark.trim() : sparkKey ? t(sparkKey) : '';

  // D1: 4 steps with the helper, 3 without — decided by writingOwn + the flag
  // (NOT the typed premise), so the dot count is stable across the spark step.
  const helperEnabled = helperStepEnabled(writingOwn, STORY_HELPER_FLAG);

  // D2/D6: fire /api/story/propose. `initial` shows the twinkle and fails open
  // to length on any non-2xx / 404 / 429 / 6s-abort; `append` is the single
  // "More ideas" re-call and never blocks (it wraps the pool on failure).
  const runProposal = async (mode: 'initial' | 'append') => {
    proposalAbortRef.current?.abort();
    const controller = new AbortController();
    proposalAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 6000);
    if (mode === 'initial') {
      setProposalLoading(true);
      shownFiredRef.current = false;
    }
    const firstChildIndex = cast.findIndex((a) => a.kind === 'CHILD');
    try {
      const res = await fetch('/api/story/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          cast: cast.map((a, i) => ({
            name: a.displayName,
            kind: a.kind,
            isStar: i === firstChildIndex,
          })),
          premise,
          pageLength,
          language,
        }),
      });
      clearTimeout(timeout);
      if (proposalAbortRef.current === controller) proposalAbortRef.current = null;
      if (!res.ok) throw new Error(`propose ${res.status}`);
      const data = (await res.json()) as { storyline: string; alternates: string[] };
      const fresh = dedupeNonEmpty([data.storyline, ...(data.alternates ?? [])]);
      if (fresh.length === 0) throw new Error('empty proposal');
      if (mode === 'append') {
        const base = proposalOptions ?? [];
        const merged = dedupeNonEmpty([...base, ...fresh]);
        const firstNew = merged.findIndex((o) => !base.includes(o));
        const idx = firstNew >= 0 ? firstNew : 0;
        setProposalOptions(merged);
        setOptionIndex(idx);
        setShapeText(merged[idx]);
        setShapeEdited(false);
        setShapeEditing(false);
      } else {
        setProposalOptions(fresh);
        setOptionIndex(0);
        setShapeText(fresh[0]);
        setShapeEdited(false);
        setShapeEditing(false);
        setProposalLoading(false);
      }
    } catch {
      clearTimeout(timeout);
      if (proposalAbortRef.current === controller) proposalAbortRef.current = null;
      if (mode === 'initial') {
        setProposalLoading(false);
        // D6 fail-open: silently continue to length with the RAW premise, but
        // only if the parent is still waiting on the shape step.
        if (stepRef.current === 'shape') {
          setAcceptedStoryline('');
          setStep('length');
        }
      } else if (proposalOptions && proposalOptions.length > 0) {
        // A "More ideas" re-call must never block a book — wrap to the pool.
        setOptionIndex(0);
        setShapeText(proposalOptions[0]);
        setShapeEdited(false);
        setShapeEditing(false);
      }
    }
  };

  // Enter the shape step. Reuses a cached proposal (or an in-flight one) for an
  // unchanged signature (D2); a changed signature drops the stale accepted text
  // and prefetches fresh. Called from the spark Next tap AND the length back
  // button, so it is a navigation action, never a step-mount effect.
  const enterShape = () => {
    const sig = storyProposalSignature({ premise, castIds, pageLength, language });
    const cachedForSig =
      sig === proposalSigRef.current &&
      (proposalOptions !== null || proposalAbortRef.current !== null);
    if (cachedForSig) {
      setStep('shape');
      return;
    }
    if (sig !== proposalSigRef.current) {
      setAcceptedStoryline('');
      setProposalOptions(null);
      setOptionIndex(0);
      setShapeText('');
      setShapeEdited(false);
      setShapeEditing(false);
      proposalRecalledRef.current = false;
    }
    proposalSigRef.current = sig;
    setStep('shape');
    void runProposal('initial');
  };

  const onSparkNext = () => {
    if (helperEnabled) enterShape();
    else setStep('length');
  };

  const skipShape = () => {
    setAcceptedStoryline('');
    track('story_helper_skipped');
    setStep('length');
  };

  const acceptShape = () => {
    const text = shapeText.trim().slice(0, 300);
    if (!text) {
      skipShape();
      return;
    }
    setAcceptedStoryline(text);
    track(shapeEdited ? 'story_helper_edited' : 'story_helper_accepted');
    setStep('length');
  };

  const moreIdeas = () => {
    const pool = proposalOptions ?? [];
    const next = optionIndex + 1;
    if (next < pool.length) {
      setOptionIndex(next);
      setShapeText(pool[next]);
      setShapeEdited(false);
      setShapeEditing(false);
      return;
    }
    // Cached ideas exhausted — ONE re-call is allowed, then it wraps.
    if (!proposalRecalledRef.current && proposalSigRef.current) {
      proposalRecalledRef.current = true;
      void runProposal('append');
      return;
    }
    if (pool.length > 0) {
      setOptionIndex(0);
      setShapeText(pool[0]);
      setShapeEdited(false);
      setShapeEditing(false);
    }
  };

  // story_helper_shown fires once per resolved proposal, when the card is
  // actually on screen (never on a fail-open that never showed a proposal).
  useEffect(() => {
    if (step === 'shape' && proposalOptions && !shownFiredRef.current) {
      shownFiredRef.current = true;
      track('story_helper_shown');
    }
  }, [step, proposalOptions]);

  const toggleCast = (avatar: AvatarSummary) => {
    setRepairTrouble(false);
    setCastIds((prev) => {
      if (prev.includes(avatar.id)) return prev.filter((id) => id !== avatar.id);
      const isPerson = avatar.kind === 'CHILD' || avatar.kind === 'ADULT';
      if (isPerson && peopleFull) return prev;
      if (!isPerson && companionsFull) return prev;
      return [...prev, avatar.id];
    });
  };

  // Repair path: draw every cast member who is missing the target style,
  // then poll the shelf until the whole cast is READY in it.
  const styleForRepair = useMemo((): StyleKey => {
    const counts = new Map<string, number>();
    for (const a of cast) {
      for (const r of a.renditions) {
        if (r.status === 'READY' && r.artStyle in STYLE_LIBRARY) {
          counts.set(r.artStyle, (counts.get(r.artStyle) ?? 0) + 1);
        }
      }
    }
    let best: StyleKey = 'vignette';
    let bestCount = -1;
    for (const key of Object.keys(STYLE_LIBRARY) as StyleKey[]) {
      const count = counts.get(key) ?? 0;
      if (count > bestCount) {
        best = key;
        bestCount = count;
      }
    }
    return best;
  }, [cast]);

  // C4: how many of the cast already have the repair target drawn — makes the
  // repair CTA's cost ("2 of 3 drawn", so 1 left to draw) legible. Read-only;
  // the repair flow itself is unchanged.
  const styleForRepairDrawn = useMemo(
    () =>
      cast.filter((a) =>
        a.renditions.some((r) => r.artStyle === styleForRepair && r.status === 'READY'),
      ).length,
    [cast, styleForRepair],
  );

  const styleLabel = (key: StyleKey) => tSetup(styleLabelKey(key));

  const startRepair = async () => {
    setRepairing(true);
    setRepairTrouble(false);
    const target = styleForRepair;
    // Skip cast members already READY *and* those already drawing (a
    // PENDING rendition is already paid for — never double-spend).
    const missing = cast.filter(
      (a) =>
        !a.renditions.some(
          (r) =>
            r.artStyle === target &&
            ((r.status === 'READY' && r.turnaroundSheetUrl) || r.status === 'PENDING'),
        ),
    );
    await Promise.all(
      missing.map((a) =>
        fetch(`/api/avatar/${a.id}/rendition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artStyle: target }),
        }).catch(() => null),
      ),
    );
    if (pollRef.current) clearInterval(pollRef.current);
    // Drawings settle in 30-90s; past four minutes something is wedged —
    // stop the poll and offer the retry state instead of spinning forever.
    const pollStartedAt = Date.now();
    pollRef.current = setInterval(async () => {
      if (Date.now() - pollStartedAt > 240_000) {
        if (pollRef.current) clearInterval(pollRef.current);
        setRepairing(false);
        setRepairTrouble(true);
        return;
      }
      const res = await fetch('/api/avatars').catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as { avatars: AvatarSummary[] };
      const fresh = data.avatars.filter((a) => a.status === 'READY');
      setAvatars(fresh);
      const freshCast = castIds
        .map((id) => fresh.find((a) => a.id === id))
        .filter((a): a is AvatarSummary => Boolean(a));
      const pending = freshCast.some((a) =>
        a.renditions.some((r) => r.artStyle === target && r.status === 'PENDING'),
      );
      const allReady =
        freshCast.length > 0 &&
        freshCast.every((a) =>
          a.renditions.some((r) => r.artStyle === target && r.status === 'READY'),
        );
      if (allReady) {
        if (pollRef.current) clearInterval(pollRef.current);
        setRepairing(false);
      } else if (!pending) {
        // Nothing pending and not all ready: a drawing settled FAILED.
        if (pollRef.current) clearInterval(pollRef.current);
        setRepairing(false);
        setRepairTrouble(true);
      }
    }, 4000);
  };

  const create = async () => {
    if (isCreating || !artStyle || !premise || cast.length === 0) return;
    setIsCreating(true);
    // D5: the accepted/edited storyline REPLACES the premise (the create schema
    // clamps ≤300); when nothing was accepted — skip or any fail-open — the raw
    // premise proceeds exactly as today.
    const finalPremise = acceptedStoryline.trim() || premise;
    try {
      // Reuse the book from a half-finished attempt (created but the story
      // enqueue did not land) — a retry tap must never mint a duplicate.
      let bookId = createdBookIdRef.current;
      if (!bookId) {
        const res = await fetch('/api/book/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookType: 'AVATAR_STORY',
            avatarIds: castIds,
            premise: finalPremise,
            pageLength,
            artStyle,
            language,
          }),
        });
        if (res.status === 409) {
          // A cast drawing is not READY in this style anymore (redraw or
          // deletion raced us) — re-check the cast rather than "try again".
          toast(t('createNotReady'));
          setRepairTrouble(false);
          setIsCreating(false);
          void load();
          return;
        }
        if (!res.ok) throw new Error(`create ${res.status}`);
        const data = (await res.json()) as { data?: { bookId?: string } };
        bookId = data.data?.bookId ?? null;
        if (!bookId) throw new Error('create returned no bookId');
        createdBookIdRef.current = bookId;
      }

      const storyRes = await fetch('/api/generate/story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId }),
      });
      // 202 = enqueued now. 409 = already generating (our first request
      // landed but its response was lost) — the story is on its way, so
      // navigating to the wait screen is the right move, not an error.
      if (storyRes.status !== 202 && storyRes.status !== 409) {
        throw new Error(`generate ${storyRes.status}`);
      }

      rememberCreatePath('avatars');
      try {
        sessionStorage.removeItem('storywink-avatar-story-draft');
      } catch {
        /* storage unavailable */
      }
      router.push(`/create/${bookId}/setup`);
    } catch (err) {
      logger.error({ err }, 'Avatar story creation did not go through');
      toast.error(t('createTrouble'));
      setIsCreating(false);
    }
  };

  // One studio instance, shared by the empty state and the "+ Add" tile. It
  // portals to document.body, so its place in the tree does not matter.
  const studioNode = studioOpen ? (
    <AvatarStudioDialog
      onClose={() => setStudioOpen(false)}
      onCreated={() => {
        collectCreatedRef.current = true;
        void load();
      }}
    />
  ) : null;

  if (loadTrouble && avatars === null) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
        <p className="font-playful text-lg text-[#1a1a1a]">{t('loadTrouble')}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 min-h-[44px] rounded-full bg-coral px-6 py-3 font-playful text-white shadow-md hover:bg-coral/90"
        >
          {t('loadRetry')}
        </button>
      </div>
    );
  }

  if (avatars === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Storydust variant="twinkle" size="card" label={t('creating')} />
      </div>
    );
  }

  if (avatars.length === 0) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
        <p className="font-playful text-lg text-[#1a1a1a]">{t('castEmpty')}</p>
        {/* B5: the primary CTA makes a character right here; the shelf stays
            reachable as a quiet secondary link. */}
        <button
          type="button"
          onClick={openStudio}
          className="mt-4 flex min-h-[44px] items-center gap-2 rounded-full bg-coral px-6 py-3 font-playful text-white shadow-md hover:bg-coral/90"
        >
          <Plus className="h-4 w-4" />
          {tCharacters('addSomeone')}
        </button>
        <Link
          href="/characters"
          className="mt-3 min-h-[44px] font-playful text-sm text-gray-500 underline decoration-dashed underline-offset-4 hover:text-gray-700"
        >
          {t('castEmptyCta')}
        </Link>
        {studioNode}
      </div>
    );
  }

  const steps = avatarStorySteps(helperEnabled);
  const stepIndex = stepIndexOf(step, helperEnabled);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-150px)] w-full max-w-2xl flex-col px-4 py-8">
      {/* Header: back + dots */}
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            const prev = prevStep(step, helperEnabled);
            if (prev === null) router.push('/create');
            else if (prev === 'shape') enterShape();
            else setStep(prev);
          }}
          className="flex min-h-[44px] items-center gap-1.5 rounded-full px-3 py-2 font-playful text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </button>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-2 rounded-full transition-all ${
                i === stepIndex ? 'w-6 bg-coral' : 'w-2 bg-gray-200'
              }`}
            />
          ))}
        </div>
        <span className="w-16" aria-hidden="true" />
      </div>

      {step === 'cast' && (
        <>
          <h1 className="text-center font-playful text-2xl font-bold text-[#1a1a1a]">
            {t('castTitle')}
          </h1>
          <p className="mt-1 text-center text-sm text-gray-500">{t('castHint')}</p>

          <div className="mt-4 flex items-center justify-center">
            <div className="flex items-center gap-1.5 rounded-full bg-gray-100/80 p-1">
              {[
                { value: 'en' as const, label: 'English' },
                { value: 'ja' as const, label: '日本語' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setLanguage(value)}
                  className={`rounded-full px-4 py-1.5 font-playful text-sm transition-all duration-200 ${
                    language === value
                      ? 'bg-coral text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
            {avatars.map((avatar) => {
              // B3: an in-flight character is a disabled twinkle tile with the
              // literal "Drawing…" label — selectability gates on isUsableAvatar
              // (via castTileState), so "why won't it select" answers itself.
              if (castTileState(avatar) === 'drawing') {
                return (
                  <div
                    key={avatar.id}
                    aria-disabled="true"
                    className="relative flex min-h-[44px] flex-col items-center justify-center rounded-2xl border-2 border-black/10 bg-white p-3 opacity-80"
                  >
                    <span className="flex h-24 w-20 items-center justify-center">
                      <Storydust variant="twinkle" size="card" />
                    </span>
                    <span className="mt-2 max-w-full truncate font-playful text-sm font-semibold text-[#1a1a1a]">
                      {avatar.displayName}
                    </span>
                    <span className="text-working-shimmer font-playful text-xs">
                      {t('castDrawing')}
                    </span>
                  </div>
                );
              }

              const selected = castIds.includes(avatar.id);
              const isPerson = avatar.kind === 'CHILD' || avatar.kind === 'ADULT';
              const capped = !selected && (isPerson ? peopleFull : companionsFull);
              // A tile that just settled from drawing pops once (B4); the class
              // drops out under motion-reduce, so the flip is instant there.
              const popped = poppedIds.has(avatar.id);
              // X7: the full-body cutout makes picking the cast feel like
              // lifting the toys off the shelf; round portrait is the fallback.
              const readyRendition = avatar.renditions.find(
                (r) => r.status === 'READY' && (r.cutoutUrl || r.portraitUrl),
              );
              const cutout = readyRendition?.cutoutUrl;
              const portrait =
                readyRendition?.portraitUrl ??
                avatar.renditions.find((r) => r.portraitUrl)?.portraitUrl;
              return (
                <button
                  key={avatar.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleCast(avatar)}
                  disabled={capped}
                  className={`relative flex min-h-[44px] flex-col items-center rounded-2xl border-2 bg-white p-3 transition-all ${
                    selected
                      ? 'border-coral ring-2 ring-coral/25'
                      : capped
                        ? 'border-black/5 opacity-40'
                        : 'border-black/10 hover:border-coral/50'
                  } ${popped ? 'motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:duration-300' : ''}`}
                >
                  {selected && (
                    <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-coral text-white">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  )}
                  {cutout ? (
                    <img
                      src={optimizeCloudinaryUrl(cutout, { additionalTransforms: 'c_limit,h_400' })}
                      alt=""
                      className="h-24 w-20 object-contain"
                    />
                  ) : portrait ? (
                    <img
                      src={portrait}
                      alt=""
                      className="h-20 w-20 rounded-full bg-[#FFF9F5] object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-20 w-20 items-center justify-center rounded-full bg-[#FFF9F5] text-3xl"
                    >
                      {KIND_EMOJI[avatar.kind]}
                    </span>
                  )}
                  <span className="mt-2 max-w-full truncate font-playful text-sm font-semibold text-[#1a1a1a]">
                    {avatar.displayName}
                  </span>
                  <span className="text-xs text-gray-400" aria-hidden="true">
                    {KIND_EMOJI[avatar.kind]}
                  </span>
                </button>
              );
            })}

            {/* B1: the "+ Add someone" tile — always the last tile in the grid,
                matching avatar-tile dimensions (grid-stretch fills the height). */}
            <button
              type="button"
              onClick={openStudio}
              className="flex min-h-[44px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-black/20 bg-white p-3 text-gray-500 transition-colors hover:border-coral/60 hover:text-coral"
            >
              <Plus className="h-7 w-7" />
              <span className="font-playful text-sm font-semibold">
                {tCharacters('addSomeone')}
              </span>
            </button>
          </div>

          {peopleFull && (
            <p className="mt-3 text-center text-xs text-gray-500">{t('castPeopleFull')}</p>
          )}
          {companionsFull && (
            <p className="mt-1 text-center text-xs text-gray-500">{t('castCompanionsFull')}</p>
          )}
          {castIds.length > 0 && composition.people === 0 && (
            <p className="mt-3 text-center text-xs text-gray-500">{t('castNeedsPerson')}</p>
          )}

          <StepCta disabled={!composition.ok} onClick={() => setStep('spark')} label={t('next')} />
        </>
      )}

      {step === 'spark' && (
        <>
          <h1 className="text-center font-playful text-2xl font-bold text-[#1a1a1a]">
            {t('sparkTitle')}
          </h1>
          <p className="mt-1 text-center text-sm text-gray-500">{t('sparkHint')}</p>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {SPARK_KEYS.map((key) => {
              const active = !writingOwn && sparkKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setSparkKey(key);
                    setWritingOwn(false);
                  }}
                  className={`min-h-[44px] rounded-full border px-4 py-2 font-playful text-sm transition-colors ${
                    active
                      ? 'border-coral bg-coral text-white'
                      : 'border-black/10 bg-white text-gray-700 hover:border-coral/50'
                  }`}
                >
                  {t(key)}
                </button>
              );
            })}
            {writingOwn ? (
              <input
                autoFocus
                value={customSpark}
                onChange={(e) => setCustomSpark(e.target.value.slice(0, 300))}
                placeholder={t('sparkPlaceholder')}
                className="min-h-[44px] w-full max-w-sm rounded-full border-2 border-coral bg-white px-4 py-2 font-playful text-sm text-[#1a1a1a] outline-none placeholder:text-gray-400"
              />
            ) : (
              // Clear outlined button, NOT a hero: solid coral fill is the
              // selected-preset signal and the Next CTA, so a filled/tinted
              // chip here would read pre-selected and out-shout the presets.
              <button
                type="button"
                onClick={() => {
                  setWritingOwn(true);
                  setSparkKey(null);
                }}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full border-2 border-coral bg-white px-4 py-2 font-playful text-sm text-coral hover:bg-coral/10"
              >
                <Pencil className="h-3.5 w-3.5" />
                {t('sparkCustom')}
              </button>
            )}
          </div>

          <StepCta disabled={premise.length === 0} onClick={onSparkNext} label={t('next')} />
        </>
      )}

      {step === 'shape' && (
        <>
          {/* D4: authorship-first — a quiet header and the parent's OWN words,
              then their idea grown into a storyline they can accept or edit. */}
          <h1 className="text-center font-playful text-2xl font-bold text-[#1a1a1a]">
            {t('helperTitle')}
          </h1>
          <p className="mx-auto mt-2 max-w-md text-center text-sm text-gray-500">
            {t('helperFrom', { premise })}
          </p>

          {proposalLoading || !proposalOptions ? (
            <div className="mt-10 flex flex-col items-center justify-center gap-3">
              <Storydust variant="twinkle" size="card" />
              <span className="text-working-shimmer font-playful text-sm">
                {t('helperThinking')}
              </span>
            </div>
          ) : (
            <>
              <div className="mx-auto mt-6 w-full max-w-md rounded-2xl border border-coral/15 bg-[#FFF9F5] px-5 py-5">
                {shapeEditing ? (
                  <textarea
                    autoFocus
                    value={shapeText}
                    onChange={(e) => {
                      setShapeText(e.target.value.slice(0, 300));
                      setShapeEdited(true);
                    }}
                    rows={5}
                    className="w-full resize-none rounded-xl border-2 border-coral bg-white px-3 py-2 font-playful text-sm leading-relaxed text-[#1a1a1a] outline-none"
                  />
                ) : (
                  <p className="font-playful text-base leading-relaxed text-[#1a1a1a]">
                    {shapeText}
                  </p>
                )}
                {!shapeEditing && (
                  <button
                    type="button"
                    onClick={() => setShapeEditing(true)}
                    className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 font-playful text-sm text-coral hover:text-coral/80"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t('helperEdit')}
                  </button>
                )}
              </div>

              <div className="mt-4 flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={moreIdeas}
                  className="min-h-[44px] font-playful text-sm text-gray-500 underline decoration-dashed underline-offset-4 hover:text-gray-700"
                >
                  {t('helperMore')}
                </button>
                <button
                  type="button"
                  onClick={skipShape}
                  className="min-h-[44px] font-playful text-sm text-gray-400 hover:text-gray-600"
                >
                  {t('helperSkip')}
                </button>
              </div>

              <StepCta disabled={false} onClick={acceptShape} label={t('helperSounds')} />
            </>
          )}
        </>
      )}

      {step === 'length' && (
        <>
          <h1 className="text-center font-playful text-2xl font-bold text-[#1a1a1a]">
            {t('lengthTitle')}
          </h1>

          <div className="mt-6 grid grid-cols-3 gap-3">
            {AVATAR_STORY_PAGE_LENGTHS.map((len) => {
              const active = pageLength === len;
              return (
                <button
                  key={len}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPageLength(len)}
                  className={`flex min-h-[44px] flex-col items-center rounded-2xl border-2 bg-white px-2 py-4 transition-all ${
                    active
                      ? 'border-coral ring-2 ring-coral/25'
                      : 'border-black/10 hover:border-coral/50'
                  }`}
                >
                  <span className="font-playful text-base font-semibold text-[#1a1a1a]">
                    {t(`length${len}`)}
                  </span>
                  <span className="mt-1 text-xs text-gray-500">
                    {t('lengthPages', { count: len })}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Art style: invisible when the cast shares exactly one style. */}
          {sharedStyles.length > 1 && (
            <div className="mt-6">
              <p className="text-center font-playful text-sm font-semibold text-[#1a1a1a]">
                {t('styleTitle')}
              </p>
              <div className="mt-3 flex justify-center gap-3">
                {sharedStyles.map((key) => {
                  const active = artStyle === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setArtStyle(key)}
                      className={`relative overflow-hidden rounded-xl border-2 transition-all ${
                        active ? 'border-coral ring-2 ring-coral ring-offset-1' : 'border-black/10'
                      }`}
                    >
                      <img
                        src={getStylePreviewUrl(key) ?? ''}
                        alt={styleLabel(key)}
                        className="h-20 w-20 object-cover"
                      />
                      <span className="absolute inset-x-0 bottom-0 bg-white/85 py-0.5 text-center font-playful text-[11px] text-[#1a1a1a]">
                        {styleLabel(key)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* No shared style: one honest repair card, never a dead end. */}
          {sharedStyles.length === 0 && (
            <div className="mx-auto mt-6 w-full max-w-md rounded-2xl border border-coral/15 bg-[#FFF9F5] px-5 py-4 text-center">
              <p className="font-playful text-sm font-semibold text-[#1a1a1a]">
                {t('styleMismatch')}
              </p>
              <p className="mt-1 text-sm text-gray-600">{t('styleMismatchHint')}</p>
              {repairing ? (
                <div className="mt-3 flex items-center justify-center gap-2">
                  <Storydust variant="twinkle" size="inline" />
                  <span className="text-working-shimmer font-playful text-sm">
                    {t('styleDrawing', { style: styleLabel(styleForRepair) })}
                  </span>
                </div>
              ) : (
                <>
                  <p className="mt-2 font-playful text-xs text-gray-500">
                    {t('styleDrawnSummary', { drawn: styleForRepairDrawn, total: cast.length })}
                  </p>
                  {repairTrouble && (
                    <p className="mt-2 text-sm text-gray-600">{t('styleRepairRetry')}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void startRepair()}
                    className="mt-3 min-h-[44px] rounded-full bg-coral px-5 py-2 font-playful text-sm text-white hover:bg-coral/90"
                  >
                    {t('styleRepairCta', { style: styleLabel(styleForRepair) })}
                  </button>
                </>
              )}
            </div>
          )}

          <StepCta
            disabled={!artStyle || isCreating}
            onClick={() => void create()}
            label={
              isCreating ? (
                <span className="flex items-center gap-2">
                  <Storydust variant="twinkle" size="inline" className="text-white" />
                  {t('creating')}
                </span>
              ) : (
                t('createCta')
              )
            }
          />
        </>
      )}

      {studioNode}
    </div>
  );
}

function StepCta({
  disabled,
  onClick,
  label,
}: {
  disabled: boolean;
  onClick: () => void;
  label: React.ReactNode;
}) {
  return (
    <div className="sticky inset-x-0 bottom-0 z-10 mt-8 pb-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-full bg-coral px-6 py-3.5 font-playful text-lg text-white shadow-md transition-colors hover:bg-coral/90 disabled:opacity-60"
      >
        {label}
      </button>
    </div>
  );
}
