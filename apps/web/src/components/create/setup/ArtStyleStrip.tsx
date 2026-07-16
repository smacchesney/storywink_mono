'use client';

import React from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { optimizeCloudinaryUrl } from '@storywink/shared';
import { STYLE_LIBRARY, StyleKey } from '@storywink/shared/prompts/styles';
import { styleLabelKey } from '@/lib/styleLabelKey';
import { cn } from '@/lib/utils';

interface ArtStyleStripProps {
  value: StyleKey;
  onChange: (style: StyleKey) => void;
}

/**
 * The horizontal 3-thumbnail art-style picker. Reuses STYLE_LIBRARY's first
 * reference image per style so there's a single source of truth for the art.
 */
export function ArtStyleStrip({ value, onChange }: ArtStyleStripProps) {
  const t = useTranslations('setup');
  const styles = Object.entries(STYLE_LIBRARY) as [StyleKey, (typeof STYLE_LIBRARY)[StyleKey]][];

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {styles.map(([key, def]) => {
        const selected = value === key;
        const label = t(styleLabelKey(key));
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              'relative aspect-square overflow-hidden rounded-xl border transition-all',
              selected
                ? 'border-coral ring-2 ring-coral ring-offset-1'
                : 'border-black/10 hover:border-coral/50',
            )}
            aria-pressed={selected}
          >
            <Image
              src={optimizeCloudinaryUrl(def.referenceImageUrls[0])}
              alt={label}
              fill
              sizes="(max-width: 768px) 33vw, 120px"
              className="object-cover"
            />
            {selected && (
              <span className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-coral text-white shadow">
                <Check className="h-3 w-3" />
              </span>
            )}
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1 pt-3 pb-1 text-center font-playful text-[11px] text-white">
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default ArtStyleStrip;
