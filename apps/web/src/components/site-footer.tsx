import Link from "next/link";
import { useTranslations } from 'next-intl';

export function SiteFooter() {
  const t = useTranslations('footer');
  return (
    <footer className="py-6 md:py-8 border-t border-border/40">
      <div className="container flex flex-col items-center justify-between gap-4 md:h-24 md:flex-row">
        <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
          {t('copyright', { year: new Date().getFullYear() })}
        </p>
        <nav className="flex gap-4 sm:gap-6 text-sm text-muted-foreground">
           <Link href="/terms" className="hover:underline hover:text-primary">{t('terms')}</Link>
           <Link href="/privacy" className="hover:underline hover:text-primary">{t('privacy')}</Link>
           {/* Add other footer links */}
        </nav>
      </div>
    </footer>
  );
} 