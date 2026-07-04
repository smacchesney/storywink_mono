"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, RefreshCw, Loader2, Wrench } from 'lucide-react';
import { BookStatus } from '@prisma/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface BookIssueBannerProps {
  bookId: string;
  status: BookStatus;
  /** For PARTIAL books: how many pages still need a new photo, if known. */
  failedCount?: number;
  /**
   * Called after a successful retry (202) so the parent can resume polling.
   * The banner sets the book back into a working state on the server.
   */
  onRetryStarted?: () => void;
}

/**
 * The friendly, non-scary way we tell a parent their book needs a hand.
 * PARTIAL sends them to the resolve flow; FAILED offers a single retry that
 * re-enters the pipeline at the right stage (POST /retry decides which).
 */
export function BookIssueBanner({
  bookId,
  status,
  failedCount,
  onRetryStarted,
}: BookIssueBannerProps) {
  const t = useTranslations('issue');
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    if (isRetrying) return;
    setIsRetrying(true);
    try {
      const res = await fetch(`/api/book/${bookId}/retry`, { method: 'POST' });
      if (res.status === 202) {
        onRetryStarted?.();
        return;
      }
      // 200 can carry a flaggedCount when only content-flagged pages remain —
      // those need the resolve flow, not a retry.
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.flaggedCount > 0) {
        toast.info(t('flaggedNeedPhoto', { count: data.flaggedCount }));
        router.push(`/book/${bookId}/resolve`);
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || 'Retry failed');
      }
      // 200 with nothing to retry — fall back to resuming polling.
      onRetryStarted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retry failed');
      setIsRetrying(false);
    }
  };

  if (status === BookStatus.PARTIAL) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
        <AlertTriangle className="h-7 w-7 text-amber-500" />
        <p className="font-playful text-base text-gray-800">
          {t('pagesNeedAttention', { count: failedCount ?? 1 })}
        </p>
        <Button
          onClick={() => router.push(`/book/${bookId}/resolve`)}
          className="rounded-full bg-[#F76C5E] px-6 font-playful text-white hover:bg-[#F76C5E]/90"
        >
          <Wrench className="mr-2 h-4 w-4" />
          {t('fixPages')}
        </Button>
      </div>
    );
  }

  // FAILED
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#F76C5E]/25 bg-[#FFF5F0] p-5 text-center">
      <AlertTriangle className="h-7 w-7 text-[#F76C5E]" />
      <p className="font-playful text-base text-gray-800">{t('somethingWentWrong')}</p>
      <p className="text-sm text-gray-500 max-w-xs">{t('failedMessage')}</p>
      <Button
        onClick={handleRetry}
        disabled={isRetrying}
        className="rounded-full bg-[#F76C5E] px-6 font-playful text-white hover:bg-[#F76C5E]/90"
      >
        {isRetrying ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        {isRetrying ? t('retrying') : t('retry')}
      </Button>
    </div>
  );
}

export default BookIssueBanner;
