'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PlayfulBackground from '@/components/ui/playful-background';
import { MASCOT_CATS_WAVING } from '@/lib/mascots';

/**
 * Route-level error boundary — the waving cats, one gentle line, and a coral
 * pill home. Static on purpose: a broken moment is the wrong time to sparkle.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errorPages');

  useEffect(() => {
    // Raw error text goes to the log, never to the parent.
    console.error('Route error boundary:', error);
  }, [error]);

  return (
    <div className="relative flex min-h-[80vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <PlayfulBackground variant="auth" />
      <Image
        src={MASCOT_CATS_WAVING}
        alt=""
        width={160}
        height={160}
        className="relative h-24 w-24 object-contain md:h-28 md:w-28"
        priority
      />
      <h1 className="relative max-w-sm font-playful text-2xl font-bold text-ink md:text-3xl">
        {t('errorTitle')}
      </h1>
      <div className="relative flex flex-col items-center gap-3">
        <Link
          href="/"
          className="rounded-full bg-coral px-8 py-3 font-playful text-white shadow-md transition-colors hover:bg-coral-hover"
        >
          {t('goHome')}
        </Link>
        <button
          onClick={reset}
          className="font-playful text-sm text-ink-soft underline underline-offset-4 hover:text-coral"
        >
          {t('errorRetry')}
        </button>
      </div>
    </div>
  );
}
