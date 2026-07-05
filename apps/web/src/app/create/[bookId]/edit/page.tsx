"use client";

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { BookStatus } from '@prisma/client';

/**
 * Legacy /create/[bookId]/edit route. The 5-tab editor is gone — this now
 * redirects by status so old links and in-flight books never 404:
 *   DRAFT / GENERATING / ILLUSTRATING → setup (which shows live progress)
 *   STORY_READY                        → review
 *   anything finished                  → preview
 */
export default function LegacyEditRedirect() {
  const params = useParams();
  const router = useRouter();
  const bookId = params.bookId as string;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/book/${bookId}`);
        if (cancelled) return;
        if (!res.ok) {
          router.replace(`/create/${bookId}/setup`);
          return;
        }
        const book = await res.json();
        if (cancelled) return;
        switch (book.status as BookStatus) {
          case BookStatus.STORY_READY:
            router.replace(`/create/review?bookId=${bookId}`);
            break;
          case BookStatus.DRAFT:
          case BookStatus.GENERATING:
          case BookStatus.ILLUSTRATING:
            router.replace(`/create/${bookId}/setup`);
            break;
          default:
            router.replace(`/book/${bookId}/preview`);
        }
      } catch {
        if (!cancelled) router.replace(`/create/${bookId}/setup`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookId, router]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-coral" />
    </div>
  );
}
