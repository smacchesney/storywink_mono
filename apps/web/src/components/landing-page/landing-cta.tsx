'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** The sparkle that rides every landing CTA. */
export function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0L14.59 8.41L23 11L14.59 13.59L12 22L9.41 13.59L1 11L9.41 8.41L12 0Z" />
    </svg>
  );
}

interface LandingCtaProps {
  onClick: () => void;
  /** `primary` = coral fill; `ghost` = coral outline (secondary asks). */
  variant?: 'primary' | 'ghost';
  /** The standard reassurance line renders under every instance by default. */
  showMicrocopy?: boolean;
  className?: string;
  buttonClassName?: string;
}

/**
 * THE landing CTA: one string, one sparkle, one microcopy line, sitewide.
 * Always enabled — routing is optimistic and middleware handles sign-in.
 */
export function LandingCta({
  onClick,
  variant = 'primary',
  showMicrocopy = true,
  className,
  buttonClassName,
}: LandingCtaProps) {
  const t = useTranslations('landing');
  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <Button
        size="lg"
        variant={variant === 'ghost' ? 'outline' : 'default'}
        className={cn(
          'group w-full px-9 py-4 font-playful text-lg sm:w-auto md:text-xl',
          variant === 'primary' && 'shadow-md shadow-coral/25',
          buttonClassName,
        )}
        onClick={onClick}
      >
        <SparkleIcon className="mr-1 h-5 w-5 transition-transform group-hover:scale-125 group-hover:rotate-12" />
        {t('createYourStorybook')}
      </Button>
      {showMicrocopy && (
        <p className="text-center text-xs text-ink-soft sm:text-sm">{t('ctaMicrocopy')}</p>
      )}
    </div>
  );
}

export default LandingCta;
