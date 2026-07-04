"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { BookStatus } from '@prisma/client';
import { isValidStyle, StyleKey } from '@storywink/shared/prompts/styles';
import { apiClient } from '@/lib/api-client';
import SetupSheet, { SetupFormState } from '@/components/create/setup/SetupSheet';
import type { StripPhoto } from '@/components/create/setup/PhotoStrip';
import type { CaptureQuestion } from '@/components/create/setup/CaptureChips';
import GenerationProgress from '@/components/create/GenerationProgress';

const DEFAULT_STYLE: StyleKey = 'vignette';
// Poll cadence while perception fills title/eventSummary/captureQuestions.
const PERCEPTION_POLL_MS = 3000;

interface BookPage {
  id: string;
  index: number;
  pageNumber: number;
  assetId: string | null;
  asset?: { id: string; url: string | null; thumbnailUrl: string | null } | null;
}

interface BookData {
  id: string;
  status: BookStatus;
  title: string;
  childName: string | null;
  artStyle: string | null;
  eventSummary: string | null;
  captureQuestions: CaptureQuestion[] | null;
  autoIllustrate: boolean;
  pages: BookPage[];
}

export default function SetupPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const t = useTranslations('setup');
  const bookId = params.bookId as string;

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<StripPhoto[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNameError, setShowNameError] = useState(false);
  const [generating, setGenerating] = useState(false);

  const [form, setForm] = useState<SetupFormState>({
    childName: '',
    title: '',
    eventSummary: '',
    captureQuestions: [],
    artStyle: DEFAULT_STYLE,
    reviewFirst: false,
  });

  // Track which fields the parent has edited so perception never clobbers them.
  const touched = useRef({ childName: false, title: false, eventSummary: false, captureQuestions: false });
  const isMountedRef = useRef(true);

  const titlePending = !form.title && !touched.current.title;
  const hasEventSummary = form.eventSummary.trim().length > 0 || touched.current.eventSummary;

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
        }))
    );

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
      return next;
    });
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

        // Prefill child name from the parent's most recent other book.
        if (!book.childName) {
          const token = await getToken();
          if (token && !cancelled && isMountedRef.current) {
            const booksRes = await apiClient.getBooks(token);
            const list = (booksRes?.data as Array<{ id: string; childName: string | null }> | undefined) ?? [];
            const recent = list.find((b) => b.id !== bookId && b.childName);
            if (recent?.childName && !touched.current.childName) {
              setForm((prev) => ({ ...prev, childName: recent.childName as string }));
            }
          }
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
  }, [bookId, getToken, mergeBook, router]);

  // Poll for perception fields until title/eventSummary/questions all land.
  useEffect(() => {
    if (isLoading || generating) return;
    const needsTitle = !touched.current.title && !form.title;
    const needsSummary = !touched.current.eventSummary && !form.eventSummary;
    const needsQuestions = !touched.current.captureQuestions && form.captureQuestions.length === 0;
    if (!needsTitle && !needsSummary && !needsQuestions) return;

    const intervalId = setInterval(async () => {
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
    []
  );

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
    [bookId, t]
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
      if (form.eventSummary.trim()) patchBody.eventSummary = form.eventSummary.trim();
      if (form.captureQuestions.length > 0) patchBody.captureQuestions = form.captureQuestions;

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
      if (isMountedRef.current) {
        toast.error(err instanceof Error ? err.message : t('saveError'));
        setIsSubmitting(false);
      }
    }
  }, [bookId, form, isSubmitting, t]);

  if (generating) {
    return <GenerationProgress bookId={bookId} reviewFirst={form.reviewFirst} />;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#F76C5E]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="font-playful text-gray-700">{t('loadError')}</p>
        <button
          onClick={() => router.push('/create')}
          className="rounded-full bg-[#F76C5E] px-6 py-2 font-playful text-white"
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
      titlePending={titlePending}
      hasEventSummary={hasEventSummary}
      isSubmitting={isSubmitting}
      showNameError={showNameError}
      onReorder={handleReorder}
      onChange={handleChange}
      onSubmit={handleSubmit}
    />
  );
}
