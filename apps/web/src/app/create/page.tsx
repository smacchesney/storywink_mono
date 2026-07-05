'use client';

import React, { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Camera, Loader2 } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import { useTranslations, useLocale } from 'next-intl';
import { apiClient } from '@/lib/api-client';
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

  const handleAssetsChange = useCallback((next: UploadedAsset[]) => {
    setAssets(next);
    setPendingCount(trayRef.current?.pendingCount() ?? 0);
  }, []);

  const handleBatchSettled = useCallback(() => {
    setPendingCount(trayRef.current?.pendingCount() ?? 0);
  }, []);

  // Wait (poll) until no tile is still uploading, so Continue never drops
  // in-flight photos. Caps at ~60s to avoid hanging on a wedged upload.
  const waitForUploads = useCallback(async () => {
    const start = Date.now();
    while (trayRef.current?.hasPending()) {
      if (Date.now() - start > 60_000) break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }, []);

  const handleContinue = useCallback(async () => {
    if (isCreating) return;
    if (!isLoaded) {
      toast.error(t('notReady'));
      return;
    }
    setIsCreating(true);
    try {
      await waitForUploads();

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
      logger.error({ err }, 'Book creation failed');
      toast.error(
        `${t('createFailed')}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
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
