'use client';

import React, { useEffect, useState } from 'react';
import { ScallopEdge } from '@/components/ui/scallop-edge';
import { cn } from '@/lib/utils';
import { LandingCta } from './landing-cta';

interface LandingStickyCtaProps {
  /** The hero CTA block — the bar appears once this leaves the viewport. */
  heroCtaRef: React.RefObject<HTMLElement | null>;
  /** The final ask band — the bar hides while any of it is on screen. */
  finalBandRef: React.RefObject<HTMLElement | null>;
  /** True while the example-book overlay is open. */
  suppressed?: boolean;
  onCtaClick: () => void;
}

function useOnScreen(ref: React.RefObject<HTMLElement | null>) {
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => setOnScreen(entries[0]?.isIntersecting ?? false),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return onScreen;
}

/**
 * Sticky mobile CTA bar (<768px): white, scallop top edge, safe-area padded.
 * Slides in once the hero CTA scrolls away; hides while the example-book
 * overlay is open and within the final ask band. Reduced motion appears
 * without the slide (the transition is motion-reduce disabled).
 */
export function LandingStickyCta({
  heroCtaRef,
  finalBandRef,
  suppressed = false,
  onCtaClick,
}: LandingStickyCtaProps) {
  const heroOnScreen = useOnScreen(heroCtaRef);
  const finalBandOnScreen = useOnScreen(finalBandRef);
  const visible = !heroOnScreen && !finalBandOnScreen && !suppressed;

  return (
    <div
      aria-hidden={!visible}
      // React 19 boolean `inert` keeps the off-screen bar out of the tab order.
      inert={!visible}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 md:hidden',
        'transition-transform duration-300 ease-out motion-reduce:transition-none',
        visible ? 'translate-y-0' : 'pointer-events-none translate-y-full',
      )}
    >
      <ScallopEdge flip fill="white" className="relative z-10 block" />
      <div className="-mt-px bg-white px-4 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <LandingCta
          onClick={onCtaClick}
          className="gap-1"
          buttonClassName={cn('w-full text-lg py-3', !visible && 'pointer-events-none')}
        />
      </div>
    </div>
  );
}

export default LandingStickyCta;
