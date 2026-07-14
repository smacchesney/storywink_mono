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
  CastKind,
} from '@/lib/avatar-story';
import { castTileState, isUsableAvatar } from '@/lib/characterPathDestination';
import { rememberCreatePath } from '@/lib/createPath';
import logger from '@/lib/logger';

// B2: dynamic + ssr:false keeps the PhotoTray/detect stack out of the wizard's
// first-load bundle — the studio only mounts when the parent taps "+ Add".
const AvatarStudioDialog = dynamic(
  () => import('@/components/characters/AvatarStudioDialog'),
  { ssr: false },
);

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

// Style display names live in the setup namespace (ArtStyleStrip precedent).
const STYLE_LABEL_KEYS: Record<string, string> = {
  vignette: 'styleVignette',
  origami: 'styleOrigami',
  kawaii: 'styleKawaii',
};

type Step = 'cast' | 'spark' | 'length';

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
  }, [castIds, sparkKey, customSpark, writingOwn, pageLength, artStyle, language]);

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
        pageLength?: AvatarStoryPageLength;
        language?: 'en' | 'ja';
      };
      if (draft.castIds?.length) setCastIds(draft.castIds);
      if (draft.sparkKey) setSparkKey(draft.sparkKey);
      if (draft.customSpark) setCustomSpark(draft.customSpark);
      if (draft.writingOwn) setWritingOwn(true);
      if (draft.pageLength && (AVATAR_STORY_PAGE_LENGTHS as readonly number[]).includes(draft.pageLength)) {
        setPageLength(draft.pageLength);
      }
      if (draft.language === 'en' || draft.language === 'ja') setLanguage(draft.language);
      if (draft.step === 'spark' || draft.step === 'length') setStep(draft.step);
    } catch {
      /* storage unavailable or stale shape — start fresh */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        'storywink-avatar-story-draft',
        JSON.stringify({ step, castIds, sparkKey, customSpark, writingOwn, pageLength, language }),
      );
    } catch {
      /* storage unavailable — drafting is best-effort */
    }
  }, [step, castIds, sparkKey, customSpark, writingOwn, pageLength, language]);

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
  // which is acceptable). Leaving the step or the last drawing settling resets
  // the clock; unmounting tears the interval down via cleanup.
  useEffect(() => {
    const drawing = avatars?.some((a) => a.renditions.some((r) => r.status === 'PENDING'));
    if (step !== 'cast' || !drawing) {
      arrivalPollStartRef.current = null;
      return;
    }
    if (arrivalPollStartRef.current === null) arrivalPollStartRef.current = Date.now();
    if (Date.now() - arrivalPollStartRef.current > 240_000) return;
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

  const styleLabel = (key: StyleKey) =>
    STYLE_LABEL_KEYS[key] ? tSetup(STYLE_LABEL_KEYS[key]) : STYLE_LIBRARY[key].label;

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
            premise,
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

  const stepIndex = step === 'cast' ? 0 : step === 'spark' ? 1 : 2;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-150px)] w-full max-w-2xl flex-col px-4 py-8">
      {/* Header: back + dots */}
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() =>
            step === 'cast'
              ? router.push('/create')
              : setStep(step === 'length' ? 'spark' : 'cast')
          }
          className="flex min-h-[44px] items-center gap-1.5 rounded-full px-3 py-2 font-playful text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </button>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
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

          {peopleFull && <p className="mt-3 text-center text-xs text-gray-500">{t('castPeopleFull')}</p>}
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

          <StepCta disabled={premise.length === 0} onClick={() => setStep('length')} label={t('next')} />
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
                    active ? 'border-coral ring-2 ring-coral/25' : 'border-black/10 hover:border-coral/50'
                  }`}
                >
                  <span className="font-playful text-base font-semibold text-[#1a1a1a]">
                    {t(`length${len}`)}
                  </span>
                  <span className="mt-1 text-xs text-gray-500">{t('lengthPages', { count: len })}</span>
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
                      <img src={getStylePreviewUrl(key) ?? ''} alt={styleLabel(key)} className="h-20 w-20 object-cover" />
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
              <p className="font-playful text-sm font-semibold text-[#1a1a1a]">{t('styleMismatch')}</p>
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
