import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ScallopEdge } from '@/components/ui/scallop-edge';

export function SiteFooter() {
  const t = useTranslations('footer');
  return (
    // z-10 keeps the footer above PlayfulBackground's fixed viewport wash,
    // which lives inside <main>'s z-10 stacking context and would otherwise
    // paint over a z-auto footer.
    <footer className="relative z-10 mt-20">
      {/* Scalloped cloud edge mirrored above the footer, book-ending the page */}
      <ScallopEdge flip fill="#FBE7D6" className="relative z-10 block" />
      <div className="-mt-px bg-[#FBE7D6]">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 py-10 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="flex flex-col items-center gap-1 sm:items-start">
            <Link
              href="/"
              className="font-playful text-2xl text-ink transition-opacity hover:opacity-80"
            >
              Storywin<span className="text-coral">k.ai</span>
            </Link>
            <p className="text-sm text-ink-soft">
              {t('copyright', { year: new Date().getFullYear() })}
            </p>
          </div>
          <nav className="flex gap-6 text-sm text-ink-soft">
            <Link href="/terms" className="transition-colors hover:text-coral">
              {t('terms')}
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-coral">
              {t('privacy')}
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
