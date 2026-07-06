import Image from 'next/image';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import PlayfulBackground from '@/components/ui/playful-background';
import { MASCOT_CATS_WAVING } from '@/lib/mascots';

/**
 * 404 — the waving cats, one line, one coral pill home. Static on purpose.
 */
export default async function NotFound() {
  const t = await getTranslations('errorPages');

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
        {t('notFoundTitle')}
      </h1>
      <Link
        href="/"
        className="relative rounded-full bg-coral px-8 py-3 font-playful text-white shadow-md transition-colors hover:bg-coral-hover"
      >
        {t('goHome')}
      </Link>
    </div>
  );
}
