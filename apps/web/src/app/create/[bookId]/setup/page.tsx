'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Storydust } from '@/components/ui/storydust';
import { BookStatus } from '@prisma/client';
import { isValidStyle, StyleKey } from '@storywink/shared/prompts/styles';
import { STORY_MOODS, type StoryMood } from '@storywink/shared/constants';
import SetupSheet, { SetupFormState } from '@/components/create/setup/SetupSheet';
import SetupWizard from '@/components/create/setup/SetupWizard';
import type { StripPhoto } from '@/components/create/setup/PhotoStrip';
import type { CaptureQuestion } from '@/components/create/setup/CaptureChips';
import { buildSubmitPatchBody } from '@/components/create/setup/setup-submit';
import { createPatchDebouncer, type PatchDebouncer } from '@/lib/patch-debounce';
import {
  CREATE_DISCOVERY_FLAG,
  ENSEMBLE_BOOKS_FLAG,
  WIZARD_ENABLED,
} from '@/lib/discovery-client';
import {
  buildDiscoveryChips,
  recurringChildren,
  type DiscoveryChip,
  type RosterCharacterLike,
} from '@/components/create/setup/discovery-feed';
import {
  ensureMemberNamingQuestions,
  mergeCaptureQuestions,
} from '@/components/create/setup/star-ask';
import { shouldExtract } from '@/components/create/setup/ramble';
import {
  mergeExtractionFacts,
  applyExtractionToQuestions,
} from '@/components/create/setup/extraction-merge';
import type { RambleExtraction } from '@/lib/ramble-extract';
import {
  allPagesAnalyzed,
  arrivalStripPhase,
  initialStripPhase,
  isFreshBook,
  type StripPhase,
} from '@/components/create/setup/strip-phase';
import {
  REREAD_WINDOW_MS,
  filterStaleCastAnswers,
  livePatchFor,
  perceptionQuestionCount,
  perceptionSnapshot,
  suppressArrival,
} from '@/components/create/setup/wizard-steps';
import GenerationProgress from '@/components/create/GenerationProgress';

const DEFAULT_STYLE: StyleKey = 'vignette';
// Poll cadence while perception fills title/eventSummary/captureQuestions.
const PERCEPTION_POLL_MS = 3000;

interface BookPage {
  id: string;
  index: number;
  pageNumber: number;
  assetId: string | null;
  asset?: {
    id: string;
    url: string | null;
    thumbnailUrl: string | null;
  } | null;
  /** Perception's per-page notes — presence marks the page as analyzed. */
  analysis?: unknown;
}

interface BookData {
  id: string;
  status: BookStatus;
  title: string;
  childName: string | null;
  /** Server-derived from the parent's most recent book when this one is an unnamed draft. */
  childNameSuggestion?: string | null;
  artStyle: string | null;
  tone: string | null;
  eventSummary: string | null;
  learningWords: { word?: string }[] | null;
  characterIdentity?: { characters?: RosterCharacterLike[] } | null;
  themeLine?: string | null;
  coverAssetId?: string | null;
  castMode?: string | null;
  starCharacterId?: string | null;
  castMemberIds?: unknown;
  captureQuestions: CaptureQuestion[] | null;
  autoIllustrate: boolean;
  createdAt: string;
  pages: BookPage[];
}

export default function SetupPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('setup');
  const bookId = params.bookId as string;

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<StripPhoto[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNameError, setShowNameError] = useState(false);
  const [generating, setGenerating] = useState(false);
  // The name the server prefilled from the parent's most recent book —
  // drives the "for {name} again!" line until the parent edits the field.
  const [prefilledName, setPrefilledName] = useState<string | null>(null);

  const [form, setForm] = useState<SetupFormState>({
    childName: '',
    title: '',
    eventSummary: '',
    captureQuestions: [],
    artStyle: DEFAULT_STYLE,
    tone: null,
    learningWords: [],
    reviewFirst: false,
    themeLine: '',
    castMode: 'star',
    starCharacterId: null,
    castMemberIds: [],
  });

  // Track which fields the parent has edited so perception never clobbers them.
  const touched = useRef({
    childName: false,
    title: false,
    eventSummary: false,
    captureQuestions: false,
    artStyle: false,
    tone: false,
    learningWords: false,
    themeLine: false,
    castMode: false,
  });
  const isMountedRef = useRef(true);

  // Perception is non-fatal by design — when the poll gives up without a
  // title, the shimmer must settle into a normal placeholder, not spin forever.
  const [perceptionSettled, setPerceptionSettled] = useState(false);

  // LibrarianStrip phase machine. 'hidden' until the initial load decides
  // whether a perception pass is plausibly in flight (see strip-phase.ts).
  const [stripPhase, setStripPhase] = useState<StripPhase>('hidden');
  // Freshness anchor + "perception provably finished" flag for the poll gate.
  const [bookCreatedAt, setBookCreatedAt] = useState<string | null>(null);
  // Perception roster id of the star, for the X6c avatar confirm row.
  const [mainCharacterId, setMainCharacterId] = useState<string | null>(null);
  const [analysisDone, setAnalysisDone] = useState(false);
  // X18: photo-mutation re-read. reReading is REACTIVE state — StepSaw must
  // fall back to the reading theater even though the stale roster/theme
  // payload is still merged. Cleared by real perception-content change or
  // window expiry (timer), never by the poll cap alone.
  const [reReading, setReReading] = useState(false);
  // Ref mirror for mergeBook's suppression path: the merge fired by the very
  // mutation that opened the window runs inside a callback chain built BEFORE
  // the state update rendered, so a state read there is stale (false) and the
  // first merge would announce arrival off stale questions. Refs don't go
  // stale; state stays the render signal for StepSaw/poll.
  const reReadingRef = useRef(false);
  const setReReadingBoth = useCallback((v: boolean) => {
    reReadingRef.current = v;
    setReReading(v);
  }, []);
  const reReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Normalized perception snapshot (identity + perception question rows).
  const perceptionSnapRef = useRef<string>('');
  // Set at mutation time; the FIRST post-mutation merge becomes the baseline
  // (the DELETE/upload response itself is not the refresh landing).
  const awaitingBaselineRef = useRef(false);
  const baselineSnapRef = useRef<string>('');
  const [mutationNonce, setMutationNonce] = useState(0);
  // Page-owned in-flight photo-mutation counter (uploads + removes + reorder).
  const [photoPending, setPhotoPending] = useState(0);
  const handlePhotoPendingDelta = useCallback((delta: 1 | -1) => {
    setPhotoPending((n) => Math.max(0, n + delta));
  }, []);
  // X17b discovery surface — roster + analysis-derived chips + composed-cover
  // asset, all fed by the same poll that fills title/summary/questions.
  const [roster, setRoster] = useState<RosterCharacterLike[]>([]);
  const [discoveryChips, setDiscoveryChips] = useState<DiscoveryChip[]>([]);
  const [coverAssetId, setCoverAssetId] = useState<string | null>(null);
  // Raw page set (index-sorted) — CastRow's face-crop sources.
  const [bookPages, setBookPages] = useState<BookPage[]>([]);

  const titlePending = !form.title && !touched.current.title && !perceptionSettled;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // X17 B4: one debounced PATCH channel for the whole discovery surface.
  const patcherRef = useRef<PatchDebouncer | null>(null);
  if (patcherRef.current === null) {
    patcherRef.current = createPatchDebouncer(async (body) => {
      await fetch(`/api/book/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    });
  }
  useEffect(() => () => patcherRef.current?.dispose(), []);

  // Merge a freshly fetched book into form state, respecting parent edits.
  const mergeBook = useCallback((book: BookData) => {
    setPhotos(
      [...book.pages]
        .sort((a, b) => a.index - b.index)
        .map((p) => ({
          id: p.id,
          thumbnailUrl: p.asset?.thumbnailUrl ?? null,
          url: p.asset?.url ?? null,
        })),
    );
    setBookPages([...book.pages].sort((a, b) => a.index - b.index));

    const star = book.characterIdentity?.characters?.find((c) => c.role === 'main_child');
    if (star) setMainCharacterId(star.characterId);

    const characters = book.characterIdentity?.characters ?? [];
    setRoster(characters);
    setCoverAssetId(book.coverAssetId ?? null);

    const analyzed = allPagesAnalyzed(book.pages);
    // Feed re-arms with the poll: chips exist only once analysis landed, and
    // a photo add/remove (analysis wiped) clears them until the re-read.
    setDiscoveryChips(analyzed ? buildDiscoveryChips(book.pages, characters) : []);

    setForm((prev) => {
      const next = { ...prev };
      if (!touched.current.title && book.title?.trim()) next.title = book.title;
      if (!touched.current.childName && book.childName) next.childName = book.childName;
      if (!touched.current.eventSummary && book.eventSummary) next.eventSummary = book.eventSummary;
      if (!touched.current.captureQuestions && book.captureQuestions?.length) {
        // Id-preserving merge: a poll tick landing before handlePickEveryone's
        // PATCH round-trips must not clobber the synthetic `name_` naming rows
        // it injected without marking captureQuestions touched.
        next.captureQuestions = mergeCaptureQuestions(book.captureQuestions, prev.captureQuestions);
      }
      if (WIZARD_ENABLED) {
        const ids = new Set(characters.map((c) => c.characterId));
        next.captureQuestions = filterStaleCastAnswers(next.captureQuestions, ids);
      }
      if (
        (!WIZARD_ENABLED || !touched.current.artStyle) &&
        book.artStyle &&
        isValidStyle(book.artStyle)
      ) {
        next.artStyle = book.artStyle as StyleKey;
      }
      // Only ever fills a resumed draft's own earlier choice — nothing but
      // the parent's tap writes Book.tone, so untouched means unwritten.
      if (
        !touched.current.tone &&
        book.tone &&
        (STORY_MOODS as readonly string[]).includes(book.tone)
      ) {
        next.tone = book.tone as StoryMood;
      }
      // Resumed drafts show their earlier learning words; parent edits win.
      if (!touched.current.learningWords && Array.isArray(book.learningWords)) {
        const words = (book.learningWords as { word?: string }[])
          .map((w) => (typeof w?.word === 'string' ? w.word : ''))
          .filter(Boolean)
          .slice(0, 4);
        if (words.length > 0) next.learningWords = words;
      }
      if (!touched.current.themeLine && book.themeLine?.trim()) next.themeLine = book.themeLine;
      if (!touched.current.castMode) {
        if (book.castMode === 'ensemble' && Array.isArray(book.castMemberIds)) {
          next.castMode = 'ensemble';
          next.castMemberIds = (book.castMemberIds as unknown[]).filter(
            (id): id is string => typeof id === 'string',
          );
        } else if (book.starCharacterId) {
          next.castMode = 'star';
          next.starCharacterId = book.starCharacterId;
        }
      }
      return next;
    });

    setAnalysisDone(analyzed);
    const snap = perceptionSnapshot(book.characterIdentity ?? null, book.captureQuestions);
    if (awaitingBaselineRef.current) {
      // First merge after a mutation: this response is the baseline, not the
      // refresh landing — record and suppress.
      awaitingBaselineRef.current = false;
      baselineSnapRef.current = snap;
    }
    const contentChanged = reReadingRef.current && snap !== baselineSnapRef.current;
    perceptionSnapRef.current = snap;
    if (contentChanged) {
      // Refresh landed — close the window so arrival can announce.
      if (reReadTimerRef.current) clearTimeout(reReadTimerRef.current);
      setReReadingBoth(false);
    }
    if (!suppressArrival(reReadingRef.current, contentChanged)) {
      setStripPhase((prev) =>
        arrivalStripPhase(prev, {
          // Wizard mode: the parent's own ramble/extraction must not read as
          // perception arrival — count only perception-authored questions and
          // ignore a parent-authored summary (Sol: premature settledEmpty).
          captureQuestionCount: WIZARD_ENABLED
            ? perceptionQuestionCount(book.captureQuestions ?? [])
            : (book.captureQuestions?.length ?? 0),
          hasEventSummary: WIZARD_ENABLED
            ? !!book.eventSummary && !touched.current.eventSummary
            : !!book.eventSummary,
          allAnalyzed: analyzed,
        }),
      );
    }
  }, [setReReadingBoth]);

  // Initial load + childName prefill from the most recent other book.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/book/${bookId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const book: BookData = await res.json();
        if (cancelled || !isMountedRef.current) return;

        // In-flight or finished books shouldn't sit on setup.
        if (book.status === BookStatus.GENERATING || book.status === BookStatus.ILLUSTRATING) {
          setGenerating(true);
          setIsLoading(false);
          return;
        }
        if (book.status === BookStatus.COMPLETED || book.status === BookStatus.PARTIAL) {
          router.replace(`/book/${bookId}/preview`);
          return;
        }
        if (book.status === BookStatus.STORY_READY) {
          router.replace(`/create/review?bookId=${bookId}`);
          return;
        }

        // X6d: this sheet is the PHOTO path's setup — an avatar-story book
        // must never land on it. A stranded avatar DRAFT (story enqueue
        // lost) restarts in the character flow; a FAILED one retries from
        // the preview screen. In-flight statuses already rendered the
        // shared wait above.
        if ((book as { bookType?: string }).bookType === 'AVATAR_STORY') {
          router.replace(
            book.status === BookStatus.DRAFT ? '/create/characters' : `/book/${bookId}/preview`,
          );
          return;
        }

        mergeBook(book);

        // Decide whether the librarian strip mounts at all. A stale book or
        // one whose analysis provably finished gets zero waiting theater —
        // and when its perception fields are still missing they are never
        // coming, so the title shimmer settles immediately too.
        setBookCreatedAt(book.createdAt);
        const fresh = isFreshBook(book.createdAt, Date.now());
        const analyzed = allPagesAnalyzed(book.pages);
        const needsTitle = !book.title?.trim();
        const needsSummary = !book.eventSummary;
        const needsQuestions = !book.captureQuestions?.length;
        const phase = initialStripPhase({
          fresh,
          allAnalyzed: analyzed,
          needsTitle,
          needsSummary,
          needsQuestions,
        });
        setStripPhase(phase);
        if (phase === 'hidden' && (needsTitle || needsSummary || needsQuestions)) {
          setPerceptionSettled(true);
        }

        // Prefill child name from the parent's most recent other book —
        // server-derived (childNameSuggestion rides the same response), so
        // no extra fetch. Still just a suggestion: fully editable, and the
        // sheet shows a one-line "for {name} again!" while it stands.
        if (!book.childName && book.childNameSuggestion && !touched.current.childName) {
          const suggestion = book.childNameSuggestion;
          setPrefilledName(suggestion);
          setForm((prev) => ({ ...prev, childName: suggestion }));
        }
      } catch (err) {
        if (!cancelled && isMountedRef.current) {
          setLoadError(err instanceof Error ? err.message : 'load failed');
        }
      } finally {
        if (!cancelled && isMountedRef.current) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, mergeBook, router]);

  // Poll for perception fields until title/eventSummary/questions all land.
  // Perception normally lands within ~15-45s; cap the poll so a failed
  // perception pass (non-fatal by design) doesn't poll forever.
  useEffect(() => {
    if (isLoading || generating) return;
    const needsTitle = !touched.current.title && !form.title;
    const needsSummary = !touched.current.eventSummary && !form.eventSummary;
    const needsQuestions = !touched.current.captureQuestions && form.captureQuestions.length === 0;
    // Keep polling while a fresh book's analysis is still in flight even if
    // the parent already typed title + summary — otherwise an eager parent
    // strands the strip mid-narration.
    const needsAnalysis =
      !analysisDone && bookCreatedAt !== null && isFreshBook(bookCreatedAt, Date.now());
    if (!needsTitle && !needsSummary && !needsQuestions && !needsAnalysis && !reReading) return;

    let polls = 0;
    const MAX_POLLS = 40; // ~2 minutes at 3s
    const intervalId = setInterval(async () => {
      polls += 1;
      if (polls > MAX_POLLS) {
        clearInterval(intervalId);
        if (isMountedRef.current) {
          // Slow and failed are indistinguishable here and treated the same:
          // the strip hands over, the sheet stays fully usable.
          setPerceptionSettled(true);
          setStripPhase((prev) => (prev === 'reading' ? 'settled' : prev));
        }
        return;
      }
      try {
        const res = await fetch(`/api/book/${bookId}`);
        if (!res.ok || !isMountedRef.current) return;
        const book: BookData = await res.json();
        if (!isMountedRef.current) return;
        mergeBook(book);
      } catch {
        // Silently retry on the next tick.
      }
    }, PERCEPTION_POLL_MS);

    return () => clearInterval(intervalId);
  }, [
    isLoading,
    generating,
    bookId,
    form.title,
    form.eventSummary,
    form.captureQuestions.length,
    // Photo add/remove re-arms the poll while the refresh pass re-runs.
    photos.length,
    analysisDone,
    bookCreatedAt,
    mergeBook,
    reReading,
    mutationNonce,
  ]);

  const handleChange = useCallback(
    <K extends keyof SetupFormState>(key: K, value: SetupFormState[K]) => {
      if (key in touched.current) {
        (touched.current as Record<string, boolean>)[key as string] = true;
      }
      if (key === 'childName') setShowNameError(false);
      setForm((prev) => ({ ...prev, [key]: value }));
      if (CREATE_DISCOVERY_FLAG) {
        if (key === 'themeLine')
          patcherRef.current?.queue({ themeLine: (value as string).trim() || null });
        if (key === 'eventSummary')
          patcherRef.current?.queue({ eventSummary: (value as string).trim() || null });
        if (key === 'captureQuestions') patcherRef.current?.queue({ captureQuestions: value });
      }
      if (WIZARD_ENABLED) {
        // Wizard sessions are minutes long — persist edits as they land so a
        // refresh resumes. livePatchFor's undefined-valued keys CANCEL a
        // pending value (clearing "Kai" mid-debounce must not flush "Kai").
        const patch = livePatchFor(key, value);
        if (patch) patcherRef.current?.queue(patch);
      }
    },
    [],
  );

  // X17 B3: star pick fixes the name binding; Everyone flips ensemble mode.
  const handlePickStar = useCallback((c: RosterCharacterLike) => {
    touched.current.castMode = true;
    setForm((prev) => ({
      ...prev,
      castMode: 'star',
      starCharacterId: c.characterId,
      castMemberIds: [],
      childName: prev.childName.trim() ? prev.childName : (c.name ?? prev.childName),
    }));
    patcherRef.current?.queue({ castMode: 'star', starCharacterId: c.characterId });
  }, []);

  const handlePickEveryone = useCallback(() => {
    // Side effects stay OUTSIDE the setForm updater (StrictMode double-invokes
    // updaters) — compute once from current state, then set + queue.
    touched.current.castMode = true;
    const kids = recurringChildren(roster);
    const members = kids.map((m) => m.characterId);
    const questions = ensureMemberNamingQuestions(form.captureQuestions, kids, (descriptor) =>
      t('memberNameQuestion', { descriptor }),
    );
    setForm((prev) => ({
      ...prev,
      castMode: 'ensemble',
      castMemberIds: members,
      starCharacterId: null,
      captureQuestions: questions,
    }));
    patcherRef.current?.queue({
      castMode: 'ensemble',
      castMemberIds: members,
      starCharacterId: null,
      captureQuestions: questions,
    });
  }, [roster, form.captureQuestions, t]);

  // X17 B4: ramble blur → extraction → fact merge. Optional garnish — every
  // failure path is silent, and the 20/hr propose rate limit bounds cost.
  const lastExtractRef = useRef<string | null>(null);
  const extractAbortRef = useRef<AbortController | null>(null);
  const extractionClosedRef = useRef(false);

  const handleReachFinish = useCallback(() => {
    extractionClosedRef.current = true;
    extractAbortRef.current?.abort();
  }, []);

  const handleNameErrorRequest = useCallback(() => setShowNameError(true), []);

  const handleRambleBlur = useCallback(async () => {
    if (extractionClosedRef.current) return;
    if (!CREATE_DISCOVERY_FLAG) return;
    const text = form.eventSummary;
    if (!shouldExtract(text, lastExtractRef.current)) return;
    lastExtractRef.current = text.trim();
    extractAbortRef.current?.abort();
    const controller = new AbortController();
    extractAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch('/api/story/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'extract', bookId, ramble: text.trim() }),
        signal: controller.signal,
      });
      if (!res.ok || !isMountedRef.current) return;
      const facts = (await res.json()) as RambleExtraction;
      if (
        extractionClosedRef.current ||
        controller.signal.aborted ||
        !isMountedRef.current
      )
        return;
      const labels = {
        location: t('factLocationQ'),
        highlight: t('factHighlightQ'),
        mishap: t('factMishapQ'),
        childSaid: t('factChildSaidQ'),
        nameQuestionFor: (descriptor: string) => t('memberNameQuestion', { descriptor }),
      };
      const { changed } = mergeExtractionFacts(form, facts, roster, labels, {
        childName: touched.current.childName,
        themeLine: touched.current.themeLine,
        castMode: touched.current.castMode,
      });
      if (Object.keys(changed).length === 0) return;
      // Scalars carry their own touched guards, so spreading them onto the
      // freshest state is safe. captureQuestions is different: the merge above
      // was computed against a `form` snapshot that is now seconds stale, and a
      // parent may have answered a naming chip mid-flight. Re-run the pure row
      // logic INSIDE the updater against `prev.captureQuestions` so the parent's
      // answer wins. `nextCq` is assigned deterministically from `prev`, so a
      // StrictMode double-invoke assigns the same value (no queue call here).
      const changedScalars: Record<string, unknown> = { ...changed };
      delete changedScalars.captureQuestions;
      let nextCq: CaptureQuestion[] | undefined;
      setForm((prev) => {
        if (extractionClosedRef.current) return prev;
        const applied = applyExtractionToQuestions(prev.captureQuestions, facts, roster, labels);
        nextCq = applied === prev.captureQuestions ? undefined : applied;
        return { ...prev, ...changedScalars, captureQuestions: applied } as SetupFormState;
      });
      const patchBody = { ...changedScalars, ...(nextCq ? { captureQuestions: nextCq } : {}) };
      if (Object.keys(patchBody).length > 0) patcherRef.current?.queue(patchBody);
    } catch {
      // Extraction is optional — silence on failure/timeout.
    } finally {
      clearTimeout(timeout);
      if (extractAbortRef.current === controller) extractAbortRef.current = null;
    }
  }, [bookId, form, roster, t]);

  // Refetch the book after photos are added/removed inline in the strip. Reuses
  // mergeBook, which respects parent edits (touched fields) and re-derives the
  // photo strip from the fresh page set.
  const refetchBook = useCallback(async () => {
    try {
      const res = await fetch(`/api/book/${bookId}`);
      if (!res.ok || !isMountedRef.current) return;
      const book: BookData = await res.json();
      if (!isMountedRef.current) return;
      mergeBook(book);
      if (!WIZARD_ENABLED) {
        // Legacy inference, byte-identical to today's behavior:
        if (!allPagesAnalyzed(book.pages) && isFreshBook(book.createdAt, Date.now())) {
          setPerceptionSettled(false);
          setStripPhase('reading');
        }
      }
    } catch {
      // Non-fatal — the strip keeps its optimistic state until the next fetch.
    }
  }, [bookId, mergeBook]);

  // X18: every photo add/remove lands here (PhotoStrip's onPhotosChanged).
  // The mutation itself proves a refresh pass is in flight — no freshness
  // gate (the DELETE route enqueues refresh:true for any DRAFT).
  const handlePhotosMutated = useCallback(async () => {
    if (WIZARD_ENABLED) {
      awaitingBaselineRef.current = true;
      setReReadingBoth(true);
      setStripPhase('reading');
      setPerceptionSettled(false);
      setAnalysisDone(false);
      setMutationNonce((n) => n + 1);
      if (reReadTimerRef.current) clearTimeout(reReadTimerRef.current);
      reReadTimerRef.current = setTimeout(() => {
        // Window expiry: stop claiming to read; the next merge announces
        // whatever is true (usually arrivedQuiet off the stale-but-only data).
        setReReadingBoth(false);
      }, REREAD_WINDOW_MS);
    }
    await refetchBook();
  }, [refetchBook, setReReadingBoth]);

  useEffect(
    () => () => {
      if (reReadTimerRef.current) clearTimeout(reReadTimerRef.current);
    },
    [],
  );

  const handleReorder = useCallback(
    async (next: StripPhoto[]) => {
      setPhotos(next);
      if (WIZARD_ENABLED) handlePhotoPendingDelta(1);
      try {
        const res = await fetch(`/api/book/${bookId}/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pages: next.map((p, idx) => ({ pageId: p.id, index: idx })),
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        toast.error(t('reorderError'));
      } finally {
        if (WIZARD_ENABLED) handlePhotoPendingDelta(-1);
      }
    },
    [bookId, t, handlePhotoPendingDelta],
  );

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    if (!form.childName.trim()) {
      setShowNameError(true);
      return;
    }
    setIsSubmitting(true);
    try {
      handleReachFinish();
      // Flush any pending debounce first (awaited, so it lands before the
      // submit PATCH — no race). This matters for clears: buildSubmitPatchBody
      // omits empty fields, so a field cleared within the debounce window would
      // otherwise keep its stale DB value. flush() early-returns when nothing
      // is pending, so the common path adds no request.
      await patcherRef.current?.flush();
      const submitForm = WIZARD_ENABLED
        ? {
            ...form,
            captureQuestions: filterStaleCastAnswers(
              form.captureQuestions,
              new Set(roster.map((c) => c.characterId)),
            ),
          }
        : form;
      const patchBody = buildSubmitPatchBody(submitForm);

      const patchRes = await fetch(`/api/book/${bookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save');
      }

      const storyRes = await fetch('/api/generate/story', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, reviewFirst: form.reviewFirst }),
      });
      if (storyRes.status !== 202) {
        const data = await storyRes.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to start generation');
      }

      if (isMountedRef.current) setGenerating(true);
    } catch (err) {
      // Raw error text goes to the log, never to the parent.
      console.error('Setup submit failed:', err);
      if (isMountedRef.current) {
        toast.error(t('saveError'));
        setIsSubmitting(false);
      }
    }
  }, [bookId, form, isSubmitting, t, handleReachFinish, roster]);

  if (generating) {
    return <GenerationProgress bookId={bookId} reviewFirst={form.reviewFirst} />;
  }

  if (isLoading) {
    return (
      <div className="bg-waiting flex min-h-[70vh] items-center justify-center">
        <Storydust variant="twinkle" size="card" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="font-playful text-gray-700">{t('loadError')}</p>
        <button
          onClick={() => router.push('/create')}
          className="rounded-full bg-coral px-6 py-2 font-playful text-white"
        >
          {t('goBack')}
        </button>
      </div>
    );
  }

  if (WIZARD_ENABLED) {
    return (
      <SetupWizard
        form={form}
        photos={photos}
        prefilledName={prefilledName}
        titlePending={titlePending}
        stripPhase={stripPhase}
        reReading={reReading}
        isSubmitting={isSubmitting}
        showNameError={showNameError}
        bookId={bookId}
        coverAssetId={coverAssetId}
        discoveryChips={discoveryChips}
        roster={roster}
        pages={bookPages}
        recurringKidCount={recurringChildren(roster).length}
        ensembleAllowed={ENSEMBLE_BOOKS_FLAG}
        photoPending={photoPending}
        summaryEdited={touched.current.eventSummary}
        onChange={handleChange}
        onReorder={handleReorder}
        onPhotosChanged={handlePhotosMutated}
        onPhotoPendingDelta={handlePhotoPendingDelta}
        onPickStar={handlePickStar}
        onPickEveryone={handlePickEveryone}
        onRambleBlur={handleRambleBlur}
        onSubmit={handleSubmit}
        onReachFinish={handleReachFinish}
        onNameErrorRequest={handleNameErrorRequest}
      />
    );
  }

  return (
    <SetupSheet
      mainCharacterId={mainCharacterId}
      discoveryChips={discoveryChips}
      roster={roster}
      coverAssetId={coverAssetId}
      pages={bookPages}
      photos={photos}
      form={form}
      prefilledName={prefilledName}
      titlePending={titlePending}
      stripPhase={stripPhase}
      summaryEdited={touched.current.eventSummary}
      isSubmitting={isSubmitting}
      showNameError={showNameError}
      bookId={bookId}
      onReorder={handleReorder}
      onPhotosChanged={refetchBook}
      onChange={handleChange}
      onPickStar={handlePickStar}
      onPickEveryone={handlePickEveryone}
      onRambleBlur={handleRambleBlur}
      onSubmit={handleSubmit}
    />
  );
}
