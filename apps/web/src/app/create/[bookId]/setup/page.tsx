'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { BookStatus } from '@prisma/client';
import { isValidStyle, StyleKey } from '@storywink/shared/prompts/styles';
import { STORY_MOODS, type StoryMood } from '@storywink/shared/constants';
import SetupSheet, {
  SetupFormState,
} from '@/components/create/setup/SetupSheet';
import type { StripPhoto } from '@/components/create/setup/PhotoStrip';
import type { CaptureQuestion } from '@/components/create/setup/CaptureChips';
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
    reviewFirst: false,
  });

  // Track which fields the parent has edited so perception never clobbers them.
  const touched = useRef({
    childName: false,
    title: false,
    eventSummary: false,
    captureQuestions: false,
    tone: false,
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
  const [analysisDone, setAnalysisDone] = useState(false);

  const titlePending =
    !form.title && !touched.current.title && !perceptionSettled;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

    setForm((prev) => {
      const next = { ...prev };
      if (!touched.current.title && book.title?.trim()) next.title = book.title;
      if (!touched.current.childName && book.childName)
        next.childName = book.childName;
      if (!touched.current.eventSummary && book.eventSummary)
        next.eventSummary = book.eventSummary;
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
      return next;
    });

    const analyzed = allPagesAnalyzed(book.pages);
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
        if (
          book.status === BookStatus.GENERATING ||
          book.status === BookStatus.ILLUSTRATING
        ) {
          setGenerating(true);
          setIsLoading(false);
          return;
        }
        if (
          book.status === BookStatus.COMPLETED ||
          book.status === BookStatus.PARTIAL
        ) {
          router.replace(`/book/${bookId}/preview`);
          return;
        }
        if (book.status === BookStatus.STORY_READY) {
          router.replace(`/create/review?bookId=${bookId}`);
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
        if (
          !book.childName &&
          book.childNameSuggestion &&
          !touched.current.childName
        ) {
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
    const needsQuestions =
      !touched.current.captureQuestions && form.captureQuestions.length === 0;
    // Keep polling while a fresh book's analysis is still in flight even if
    // the parent already typed title + summary — otherwise an eager parent
    // strands the strip mid-narration.
    const needsAnalysis =
      !analysisDone &&
      bookCreatedAt !== null &&
      isFreshBook(bookCreatedAt, Date.now());
    if (!needsTitle && !needsSummary && !needsQuestions && !needsAnalysis)
      return;

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
      if (
        !allPagesAnalyzed(book.pages) &&
        isFreshBook(book.createdAt, Date.now())
      ) {
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
      const patchBody: Record<string, unknown> = {
        childName: form.childName.trim(),
        artStyle: form.artStyle,
        autoIllustrate: !form.reviewFirst,
      };
      if (form.title.trim()) patchBody.title = form.title.trim();
      if (form.eventSummary.trim())
        patchBody.eventSummary = form.eventSummary.trim();
      // Only ever set by a tap on the mood row — provenance stays parental.
      if (form.tone) patchBody.tone = form.tone;
      if (form.captureQuestions.length > 0)
        patchBody.captureQuestions = form.captureQuestions;

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
    return (
      <GenerationProgress bookId={bookId} reviewFirst={form.reviewFirst} />
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-coral" />
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
