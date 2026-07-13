'use client';

/**
 * X8-C1: the photo-first create flow, extracted to its own route. The chooser
 * lands on /create in a later task; /create/photos is the deep-linkable photo
 * path. The back affordance appears only when the chooser exists (behind
 * NEXT_PUBLIC_AVATARS_ENABLED) — dark environments must not offer a back link
 * that leads to the identical page. Link (not router.back()) so deep-linked
 * visitors with no history entry still land on /create.
 */

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PhotoBookCreate } from '@/components/create/PhotoBookCreate';

export default function CreatePhotosPage() {
  const t = useTranslations('create');
  const showBack = process.env.NEXT_PUBLIC_AVATARS_ENABLED === 'true';

  return (
    <>
      {showBack && (
        <div className="mx-auto w-full max-w-2xl px-4 pt-4">
          <Link
            href="/create"
            className="inline-flex min-h-[44px] items-center gap-1 font-playful text-sm text-gray-500 hover:text-gray-700"
          >
            <ChevronLeft className="h-4 w-4" />
            {t('backToChooser')}
          </Link>
        </div>
      )}
      <PhotoBookCreate />
    </>
  );
}
