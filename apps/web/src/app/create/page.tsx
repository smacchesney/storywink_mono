'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Camera, Loader2 } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import { useTranslations, useLocale } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { track } from '@/lib/track';
import logger from '@/lib/logger';
import { BOOK_CONSTRAINTS } from '@storywink/shared';
import type { BookLanguage } from '@storywink/shared/schemas';
import PhotoTray, { type PhotoTrayHandle } from '@/components/upload/PhotoTray';
import type { UploadedAsset } from '@/lib/uploadPhotos';

export default function CreateBookPage() {
  const router = useRouter();
  const t = useTranslations('create');
  const locale = useLocale();
  const { getToken, isLoaded } = useAuth();

  const [language, setLanguage] = useState<BookLanguage>(
    (locale === 'ja' ? 'ja' : 'en') as BookLanguage,
  );
  // Uploaded assets in tile order, mirrored from the tray for reactive UI.
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isCreating, setIsCreating] = useState(false);

  const trayRef = useRef<PhotoTrayHandle>(null);

  // Funnel telemetry: the create journey starts when this page mounts.
  useEffect(() => {
    track('create_started');
  }, []);

  const handleAssetsChange = useCallback((next: UploadedAsset[]) => {
    setAssets(next);
    setPendingCount(trayRef.current?.pendingCount() ?? 0);
  }, []);

  const handleBatchSettled = useCallback(() => {
    setPendingCount(trayRef.current?.pendingCount() ?? 0);
  }, []);

  // Wait (poll) until no tile is still uploading, so Continue never drops
  // in-flight photos. Caps at ~60s to avoid hanging on a wedged upload.
  // Returns how many photos were still pending when we gave up, so the
  // parent hears about anything left behind instead of silence.
  const waitForUploads = useCallback(async (): Promise<number> => {
    const start = Date.now();
    while (trayRef.current?.hasPending()) {
      if (Date.now() - start > 60_000) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    return trayRef.current?.pendingCount() ?? 0;
  }, []);

  const handleContinue = useCallback(async () => {
    if (isCreating) return;
    if (!isLoaded) {
      toast.error(t('notReady'));
      return;
    }
    setIsCreating(true);
    try {
      const leftBehind = await waitForUploads();
      if (leftBehind > 0) {
        toast.warning(t('photosLeftBehind', { count: leftBehind }));
      }

      const finalAssets = trayRef.current?.getUploadedAssets() ?? assets;
      const assetIds = finalAssets.map((a) => a.id);
      if (assetIds.length === 0) {
        toast.error(t('noPhotos'));
        setIsCreating(false);
        return;
      }

      const token = await getToken();
      if (!token) throw new Error('not authenticated');

      const response = await apiClient.createBook(
        { assetIds, language },
        token,
      );
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Book creation failed');
      }

      const bookId = (response.data as { id: string }).id;
      router.push(`/create/${bookId}/setup`);
    } catch (err) {
      // Raw error text goes to the log, never to the parent.
      logger.error({ err }, 'Book creation failed');
      toast.error(t('createFailed'), { description: t('createFailedHint') });
      setIsCreating(false);
    }
  }, [
    isCreating,
    isLoaded,
    assets,
    language,
    getToken,
    router,
    t,
    waitForUploads,
  ]);

  const hasReady = assets.length > 0;
  const continueLabel =
    pendingCount > 0
      ? t('stillUploading', { count: pendingCount })
      : t('continue');

  return (
    <div className="mx-auto flex min-h-[calc(100vh-150px)] w-full max-w-2xl flex-col px-4 py-8">
      <div className="mb-6 text-center">
        <h1 className="font-playful text-2xl font-bold text-[#1a1a1a] md:text-3xl">
          {t('startCreating')}
        </h1>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-gray-100/80 px-4 py-2">
          <Camera className="h-4 w-4 shrink-0 text-coral" />
          <p className="text-sm text-gray-500">
            {t('photoLimit', { max: BOOK_CONSTRAINTS.MAX_PHOTOS })}
          </p>
        </div>
      </div>

      {/* Language selector */}
      <div className="mb-6 flex items-center justify-center">
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

      <PhotoTray
        trayRef={trayRef}
        onAssetsChange={handleAssetsChange}
        onBatchSettled={handleBatchSettled}
      />

      {/* Photo curation tips — copy only, no interactions. Which photos go
          in bounds everything downstream (story, arc, consistency). */}
      <div className="mx-auto mt-6 w-full max-w-md rounded-2xl border border-coral/15 bg-[#FFF9F5] px-5 py-4">
        <p className="font-playful text-sm font-semibold text-[#1a1a1a]">
          {t('tipsTitle')}
        </p>
        <ul className="mt-2 space-y-1.5 text-sm text-gray-600">
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-coral">✦</span>
            {t('tipVariety')}
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-coral">✦</span>
            {t('tipArc')}
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true" className="text-coral">✦</span>
            {t('tipSkipDupes')}
          </li>
        </ul>
      </div>

      {/* Continue — primary coral, enabled once at least one upload has finished */}
      {(hasReady || pendingCount > 0) && (
        <div className="sticky inset-x-0 bottom-0 z-10 mt-6 pb-2">
          <button
            onClick={handleContinue}
            disabled={!hasReady || isCreating}
            className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-full bg-coral px-6 py-3.5 font-playful text-lg text-white shadow-md transition-colors hover:bg-coral/90 disabled:opacity-60"
          >
            {isCreating ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {t('creating')}
              </>
            ) : (
              continueLabel
            )}
          </button>
        </div>
      )}
    </div>
  );
}
