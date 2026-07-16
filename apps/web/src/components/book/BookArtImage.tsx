'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { cloudinaryLoader } from '@/lib/cloudinary-loader';

interface BookArtImageProps {
  /** RAW Cloudinary URL — the loader adds the one transform itself. */
  src: string;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
  /** Warm-window pages want eager fetching even off-screen. */
  eager?: boolean;
  /** Fade in over the blurred backdrop instead of popping. */
  fadeIn?: boolean;
}

/**
 * The one way book art renders: straight from Cloudinary's CDN via
 * `cloudinaryLoader` (skipping the Railway Next optimizer), with a fallback
 * to the untouched URL if a transform ever fails to resolve.
 */
export default function BookArtImage({
  src,
  alt,
  sizes,
  className,
  priority = false,
  eager = false,
  fadeIn = false,
}: BookArtImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      loader={failed ? undefined : cloudinaryLoader}
      unoptimized={failed}
      priority={priority}
      loading={!priority && eager ? 'eager' : undefined}
      onError={() => setFailed(true)}
      onLoad={() => setLoaded(true)}
      className={cn(
        'object-cover',
        fadeIn && 'transition-opacity duration-200',
        fadeIn && !loaded && 'opacity-0',
        className,
      )}
    />
  );
}
