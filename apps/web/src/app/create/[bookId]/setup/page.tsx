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
import type { StripPhoto } from '@/components/create/setup/PhotoStrip';
import type { CaptureQuestion } from '@/components/create/setup/CaptureChips';
import { buildSubmitPatchBody } from '@/components/create/setup/setup-submit';
import { createPatchDebouncer, type PatchDebouncer } from '@/lib/patch-debounce';
import { CREATE_DISCOVERY_FLAG } from '@/lib/discovery-client';
import {
  buildDiscoveryChips,
  type DiscoveryChip,
  type RosterCharacterLike,
} from '@/components/create/setup/discovery-feed';
import {
  allPagesAnalyzed,
  arrivalStripPhase,
  initialStripPhase,
  isFreshBook,
  type StripPhase,
} from '@/components/create/setup/strip-phase';
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
  // X17b discovery surface — roster + analysis-derived chips + composed-cover
  // asset, all fed by the same poll that fills title/summary/questions.
  const [roster, setRoster] = useState<RosterCharacterLike[]>([]);
  const [discoveryChips, setDiscoveryChips] = useState<DiscoveryChip[]>([]);
  const [coverAssetId, setCoverAssetId] = useState<string | null>(null);

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
        next.captureQuestions = book.captureQuestions;
      }
      if (book.artStyle && isValidStyle(book.artStyle)) {
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
    // A strip that is narrating announces the arrival; every other phase is
    // sticky, so refetches never re-announce.
    setStripPhase((prev) =>
      arrivalStripPhase(prev, {
        captureQuestionCount: book.captureQuestions?.length ?? 0,
        hasEventSummary: !!book.eventSummary,
        allAnalyzed: analyzed,
      }),
    );
  }, []);

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
    if (!needsTitle && !needsSummary && !needsQuestions && !needsAnalysis) return;

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
    },
    [],
  );

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
      // A photo add/remove enqueues a refresh pass, so un-analyzed pages on a
      // fresh book mean reading has started over. Stale books stay quiet —
      // their poll gate would never re-arm, so a strip would strand.
      if (!allPagesAnalyzed(book.pages) && isFreshBook(book.createdAt, Date.now())) {
        setPerceptionSettled(false);
        setStripPhase('reading');
      }
    } catch {
      // Non-fatal — the strip keeps its optimistic state until the next fetch.
    }
  }, [bookId, mergeBook]);

  const handleReorder = useCallback(
    async (next: StripPhoto[]) => {
      setPhotos(next);
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
      }
    },
    [bookId, t],
  );

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    if (!form.childName.trim()) {
      setShowNameError(true);
      return;
    }
    setIsSubmitting(true);
    try {
      // The submit PATCH is the full-form source of truth; drop any pending
      // debounce so a racing partial PATCH can't land after it.
      patcherRef.current?.dispose();
      const patchBody = buildSubmitPatchBody(form);

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
  }, [bookId, form, isSubmitting, t]);

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

  return (
    <SetupSheet
      mainCharacterId={mainCharacterId}
      discoveryChips={discoveryChips}
      roster={roster}
      coverAssetId={coverAssetId}
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
      onSubmit={handleSubmit}
    />
  );
}
