'use client';

import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from 'react';
import HTMLFlipBook from 'react-pageflip';
import { Page } from '@prisma/client';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { PAGE_TEXT } from '@storywink/shared/constants';
import { collageSlots } from '@storywink/shared/collage';
import { splitEmphasisSegments } from '@storywink/shared/text-emphasis';
import { MASCOT_CATS_SITTING } from '@/lib/mascots';
import { tinyThumbUrl } from '@/lib/cloudinary-loader';
import BookArtImage from './BookArtImage';
import {
  buildDisplayPages,
  remapDisplayIndex,
  type BookLayout,
  type DisplayPage,
} from './display-pages';

// Layout logic lives in ./display-pages (pure, unit-tested); re-export so
// existing importers keep working.
export { buildDisplayPages, remapDisplayIndex } from './display-pages';
export type { BookLayout, DisplayPage, BuildDisplayPagesOptions } from './display-pages';

// Mascot URLs
const DEDICATION_MASCOT_URL =
  'https://res.cloudinary.com/storywink/image/upload/v1772291377/Screenshot_2026-02-28_at_10.58.09_PM_gnknk5.png';
const ENDING_MASCOT_URL =
  'https://res.cloudinary.com/storywink/image/upload/v1772291378/Screenshot_2026-02-28_at_10.57.54_PM_sxcasb.png';
const BACK_COVER_MASCOT_URL =
  'https://res.cloudinary.com/storywink/image/upload/v1772291378/Screenshot_2026-02-28_at_10.57.29_PM_qwoqr0.png';
const BLANK_PAGE_MASCOT_URL =
  'https://res.cloudinary.com/storywink/image/upload/v1772291382/Screenshot_2026-02-28_at_10.54.21_PM_saradc.png';

interface FlipbookViewerProps {
  pages: Page[];
  /**
   * The dedicated painted cover (Book.coverImageUrl). When present it fronts
   * the book in the cover slot; the title page's story-style render stays as
   * the fallback for older books that never got one.
   */
  coverImageUrl?: string | null;
  initialPageNumber?: number;
  onPageChange?: (displayIndex: number) => void;
  /**
   * Fires whenever the auto-detected layout ('spread' on wide containers,
   * 'portrait' on phones held upright) settles or changes, so the parent can
   * build matching display pages for its own chrome (gallery, footer count).
   */
  onLayoutChange?: (layout: BookLayout) => void;
  className?: string;
  childName?: string | null;
  bookTitle?: string;
  language?: string;
  /** Original photos for the real-moments collage (flag-gated by the caller). */
  collagePhotos?: { id: string; url: string }[];
  /** Book creation date for the collage subline. */
  collageCreatedAt?: Date | string | null;
}

// Define the type for the imperative handle
export interface FlipbookActions {
  pageFlip: () => any; // Expose the pageFlip API instance
}

// Use forwardRef to allow passing ref from parent
const FlipbookViewer = forwardRef<FlipbookActions, FlipbookViewerProps>(
  (
    {
      pages,
      collagePhotos,
      collageCreatedAt,
      coverImageUrl,
      initialPageNumber = 1,
      onPageChange,
      onLayoutChange,
      className,
      childName,
      bookTitle,
      language = 'en',
    },
    ref, // Receive the forwarded ref
  ) => {
    const t = useTranslations('preview');
    const flipBookInternalRef = useRef<any>(null);
    const [containerDimensions, setContainerDimensions] = useState<{
      width: number;
      height: number;
    }>({ width: 0, height: 0 });
    const containerRef = useRef<HTMLDivElement>(null); // Ref for the container div
    const [currentPageIndex, setCurrentPageIndex] = useState(0);
    const [isFlipping, setIsFlipping] = useState(false);
    // Read once — a flip animation should be near-instant for parents who ask
    // the OS for reduced motion.
    const prefersReducedMotion = useMemo(
      () =>
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
      [],
    );

    // Expose the pageFlip instance via the forwarded ref
    useImperativeHandle(ref, () => ({
      pageFlip: () => flipBookInternalRef.current?.pageFlip(),
    }));

    // Adjust size based on container for responsiveness
    useEffect(() => {
      const resizeObserver = new ResizeObserver(([entry]) => {
        if (entry) {
          setContainerDimensions({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      });

      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      return () => {
        resizeObserver.disconnect();
      };
    }, []);

    // Calculate optimal dimensions based on container
    const calculateBookDimensions = () => {
      const { width, height } = containerDimensions;
      const padding = 32; // Total padding to account for
      const availableWidth = width - padding;
      const availableHeight = height - padding;

      // Smart adaptive logic for single vs double page view
      const aspectRatio = width / height;
      const isExtremeAspectRatio = aspectRatio > 2.5;
      const hasMinimumHeight = height >= 350;
      const shouldShowSpread = width >= 640 && hasMinimumHeight && !isExtremeAspectRatio;

      // For single page view (mobile portrait, landscape with limited height)
      if (!shouldShowSpread) {
        // Use most of available width/height, maintaining aspect ratio
        const pageWidth = availableWidth;
        const pageHeight = availableHeight;
        // Combined story pages: square illustration on top + text strip below
        const pageAspectRatio = 0.78;

        let finalWidth = pageWidth;
        let finalHeight = pageHeight;

        // Adjust to maintain aspect ratio
        if (pageWidth / pageHeight > pageAspectRatio) {
          finalWidth = pageHeight * pageAspectRatio;
        } else {
          finalHeight = pageWidth / pageAspectRatio;
        }

        return {
          width: Math.floor(finalWidth),
          height: Math.floor(finalHeight),
          isPortrait: true,
        };
      }

      // For desktop/tablet (double page spread view)
      const spreadAspectRatio = 2.0; // Double page spread (two square pages side by side)
      let spreadWidth = availableWidth;
      let spreadHeight = availableHeight;

      if (spreadWidth / spreadHeight > spreadAspectRatio) {
        spreadWidth = spreadHeight * spreadAspectRatio;
      } else {
        spreadHeight = spreadWidth / spreadAspectRatio;
      }

      const pageWidth = Math.floor(spreadWidth / 2);
      const pageHeight = Math.floor(spreadHeight);

      return {
        width: pageWidth,
        height: pageHeight,
        isPortrait: false,
      };
    };

    const {
      width: pageWidth,
      height: pageHeight,
      isPortrait,
    } = containerDimensions.width > 0
      ? calculateBookDimensions()
      : { width: 0, height: 0, isPortrait: false };

    const layout: BookLayout = isPortrait ? 'portrait' : 'spread';

    // Build interleaved display pages for the active layout
    const displayPages = useMemo(
      () =>
        buildDisplayPages(pages, {
          childName,
          bookTitle,
          language,
          layout,
          collagePhotos,
          collageCreatedAt,
        }),
      [pages, childName, bookTitle, language, layout, collagePhotos, collageCreatedAt],
    );

    // Warm-window image mounting: pages near the reader (current ± 3) mount
    // their full-resolution art eagerly; pages already loaded never regress to
    // the blurred backdrop when flipping backwards.
    const loadedPagesRef = useRef<Set<number>>(new Set());
    const shouldMountImage = (index: number): boolean => {
      if (
        index <= 2 ||
        Math.abs(index - currentPageIndex) <= 3 ||
        loadedPagesRef.current.has(index)
      ) {
        loadedPagesRef.current.add(index);
        return true;
      }
      return false;
    };

    // Rotation handling: when the layout flips mid-read, the flipbook remounts
    // (key below) and the reader lands on the same story beat via a source-id
    // remap. currentIndexRef mirrors currentPageIndex for use in effects;
    // pendingInitIndexRef carries the mapped index into the remounted book.
    const currentIndexRef = useRef(0);
    const pendingInitIndexRef = useRef<number | null>(null);
    const layoutSnapshotRef = useRef<{
      layout: BookLayout;
      displayPages: DisplayPage<Page>[];
    } | null>(null);

    useEffect(() => {
      if (containerDimensions.width === 0) return; // not measured yet
      const prev = layoutSnapshotRef.current;
      if (prev && prev.layout !== layout) {
        const mapped = remapDisplayIndex(prev.displayPages, currentIndexRef.current, displayPages);
        loadedPagesRef.current = new Set(); // indices mean different pages now
        currentIndexRef.current = mapped;
        pendingInitIndexRef.current = mapped;
        setCurrentPageIndex(mapped);
        try {
          // If the remounted flipbook is already live, jump straight there;
          // otherwise onInit picks pendingInitIndexRef up.
          flipBookInternalRef.current?.pageFlip()?.turnToPage(mapped);
        } catch {
          // The remount lands on the mapped page via onInit.
        }
        if (onPageChange) {
          onPageChange(mapped + 1);
        }
      }
      if (!prev || prev.layout !== layout) {
        onLayoutChange?.(layout);
      }
      layoutSnapshotRef.current = { layout, displayPages };
    }, [layout, displayPages, containerDimensions.width, onPageChange, onLayoutChange]);

    // Gallery jumps arrive as a turnToPage on the exposed pageFlip instance,
    // which fires no flip event — but the parent reflects the new position
    // back through initialPageNumber. Sync it so the warm window and cover
    // centering track jumps, not just flips.
    useEffect(() => {
      // While a rotation remap is in flight, initialPageNumber still speaks the
      // previous layout's numbering — leave the mapped index alone until the
      // remounted book has landed (onInit clears the pending marker).
      if (pendingInitIndexRef.current !== null) return;
      const idx = Math.max(0, Math.min(initialPageNumber - 1, displayPages.length - 1));
      currentIndexRef.current = idx;
      setCurrentPageIndex(idx);
    }, [initialPageNumber, displayPages.length]);

    // Center front/back covers in spread mode (they only occupy half the spread area)
    // When a flip starts, immediately uncenter so the shift animates WITH the page flip
    const shouldCenterCover = !isPortrait && !isFlipping;
    const coverOffset = shouldCenterCover
      ? currentPageIndex === 0
        ? -pageWidth / 2
        : currentPageIndex >= displayPages.length - 1
          ? pageWidth / 2
          : 0
      : 0;

    // Handler for page flip event from the library
    const handleFlip = useCallback(
      (e: any) => {
        const currentPage = e.data;
        currentIndexRef.current = currentPage;
        setCurrentPageIndex(currentPage);
        setIsFlipping(false);
        if (onPageChange) {
          onPageChange(currentPage + 1); // Library is 0-indexed
        }
      },
      [onPageChange],
    );

    // Detect flip start so cover centering transitions simultaneously with page flip
    const handleStateChange = useCallback((e: any) => {
      if (e.data === 'flipping') {
        setIsFlipping(true);
      } else if (e.data === 'read') {
        setIsFlipping(false);
      }
    }, []);

    // Add onInit handler to turn to initial page once ready. A pending index
    // from a layout rotation wins over the parent's initialPageNumber (which
    // is still expressed in the previous layout's numbering).
    const handleInit = useCallback(() => {
      const pending = pendingInitIndexRef.current;
      pendingInitIndexRef.current = null;
      const target = pending ?? (initialPageNumber ? initialPageNumber - 1 : 0);
      const pageIndex = Math.max(0, Math.min(target, displayPages.length - 1));
      currentIndexRef.current = pageIndex;
      if (flipBookInternalRef.current) {
        try {
          flipBookInternalRef.current?.pageFlip()?.turnToPage(pageIndex);
        } catch (e) {
          console.error('Error turning page on init:', e);
        }
      }
    }, [initialPageNumber, displayPages.length]);

    /** Tiny Cloudinary variant, blurred by CSS — paints before any art loads */
    const renderBlurBackdrop = (url: string) => (
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${tinyThumbUrl(url)})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(10px)',
          transform: 'scale(1.08)',
        }}
      />
    );

    /** Story text with learning words emphasized (bold + coral, same size). */
    const renderStoryText = (page: Page) =>
      splitEmphasisSegments(page.text || '', page.learningWordsUsed ?? []).map((seg, i) =>
        seg.emphasized ? (
          <strong key={i} className="text-coral" style={{ fontWeight: 700 }}>
            {seg.text}
          </strong>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      );

    /** Render a single display page */
    const renderDisplayPage = (dp: DisplayPage<Page>, index: number) => {
      // Container-relative font sizes (scale with page width, not viewport)
      const bodySize = Math.max(12, Math.min(Math.round(pageWidth * 0.05), 22));
      const smallBodySize = Math.max(11, Math.min(Math.round(pageWidth * 0.045), 18));
      const nameSize = Math.max(16, Math.min(Math.round(pageWidth * 0.07), 30));
      const titleSize = Math.max(18, Math.min(Math.round(pageWidth * 0.08), 32));
      const brandSize = Math.max(16, Math.min(Math.round(pageWidth * 0.065), 28));

      if (dp.type === 'blank') {
        return (
          <div
            key={`blank-${index}`}
            className="overflow-hidden rounded-lg border border-black/15 bg-white"
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <Image
                src={BLANK_PAGE_MASCOT_URL}
                alt="Storywink mascots"
                width={300}
                height={300}
                className="object-contain"
                style={{ width: '24%', height: 'auto' }}
              />
            </div>
          </div>
        );
      }

      if (dp.type === 'dedication') {
        const displayName = dp.childName || dp.bookTitle || 'You';
        const texts = PAGE_TEXT[dp.language as keyof typeof PAGE_TEXT] || PAGE_TEXT.en;
        const fontClass = dp.language === 'ja' ? 'font-japanese' : 'font-playful';
        return (
          <div
            key={`dedication-${index}`}
            className="overflow-hidden rounded-lg border border-black/15 bg-white"
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="px-[10%] text-center">
                {dp.language === 'ja' ? (
                  <>
                    <p
                      className={`${fontClass} leading-relaxed text-[#1a1a1a]`}
                      style={{ fontSize: `${smallBodySize}px` }}
                    >
                      {texts.dedicationLine1}
                    </p>
                    <p
                      className={`${fontClass} mt-1 font-bold text-coral`}
                      style={{ fontSize: `${nameSize}px` }}
                    >
                      {displayName}
                    </p>
                    <p
                      className={`${fontClass} mt-1 leading-relaxed text-[#1a1a1a]`}
                      style={{ fontSize: `${smallBodySize}px` }}
                    >
                      {texts.dedicationLine2}
                    </p>
                  </>
                ) : (
                  <>
                    <p
                      className={`${fontClass} leading-relaxed text-[#1a1a1a]`}
                      style={{ fontSize: `${smallBodySize}px` }}
                    >
                      {texts.dedicationLine1}
                      <br />
                      {texts.dedicationLine2}
                    </p>
                    <p
                      className={`${fontClass} mt-1 font-bold text-coral`}
                      style={{ fontSize: `${nameSize}px` }}
                    >
                      {displayName}
                    </p>
                  </>
                )}
              </div>
            </div>
            <Image
              src={DEDICATION_MASCOT_URL}
              alt="Storywink mascot"
              width={200}
              height={200}
              className="absolute object-contain"
              style={{ bottom: '6%', right: '6%', height: '15%', width: 'auto' }}
            />
          </div>
        );
      }

      if (dp.type === 'ending') {
        const displayName = dp.childName || dp.bookTitle || 'You';
        const texts = PAGE_TEXT[dp.language as keyof typeof PAGE_TEXT] || PAGE_TEXT.en;
        const fontClass = dp.language === 'ja' ? 'font-japanese' : 'font-playful';
        return (
          <div
            key={`ending-${index}`}
            className="overflow-hidden rounded-lg border border-black/15 bg-white"
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="px-[10%] text-center">
                <p
                  className={`${fontClass} font-bold text-[#1a1a1a]`}
                  style={{ fontSize: `${titleSize}px` }}
                >
                  {texts.endingTitle}
                </p>
                <p
                  className={`${fontClass} mt-2 leading-relaxed text-[#1a1a1a]`}
                  style={{ fontSize: `${smallBodySize}px` }}
                >
                  {texts.endingLine}
                </p>
                <p
                  className={`${fontClass} mt-1 font-bold text-coral`}
                  style={{ fontSize: `${nameSize}px` }}
                >
                  {displayName}!
                </p>
              </div>
              <Image
                src={ENDING_MASCOT_URL}
                alt="Storywink mascot"
                width={200}
                height={200}
                className="mt-4 object-contain"
                style={{ height: '15%', width: 'auto' }}
              />
            </div>
          </div>
        );
      }

      if (dp.type === 'back-cover') {
        return (
          <div
            key={`back-cover-${index}`}
            className="overflow-hidden rounded-lg border border-black/15 bg-white"
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-center">
                <span
                  className="font-playful font-bold text-[#1a1a1a]"
                  style={{ fontSize: `${brandSize}px` }}
                >
                  Storywin<span className="text-coral">k.ai</span>
                </span>
              </div>
              <Image
                src={BACK_COVER_MASCOT_URL}
                alt="Storywink mascot"
                width={150}
                height={150}
                className="mt-4 object-contain"
                style={{ height: '15%', width: 'auto' }}
              />
            </div>
          </div>
        );
      }

      // Shared placeholder for a page whose picture isn't ready yet
      // (mid-generation, a re-render, or a PARTIAL book read before its fix).
      const renderCookingPlaceholder = () => (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#FFFBF5] px-[10%] text-center">
          <Image
            src={DEDICATION_MASCOT_URL}
            alt=""
            width={200}
            height={200}
            className="object-contain opacity-80"
            style={{ height: '18%', width: 'auto' }}
          />
          <p
            className="mt-3 font-playful leading-relaxed text-gray-500"
            style={{ fontSize: `${smallBodySize}px` }}
          >
            {t('pageCooking')}
          </p>
        </div>
      );

      // Real-moments collage: the same slot geometry print uses, scaled from
      // the 8.75in page to this container's pixels.
      if (dp.type === 'collage') {
        const scale = pageWidth / 8.75;
        const texts = PAGE_TEXT[dp.language as keyof typeof PAGE_TEXT] || PAGE_TEXT.en;
        const collageTitle =
          (texts as { collageTitle?: string }).collageTitle ?? PAGE_TEXT.en.collageTitle;
        const collageFontClass = dp.language === 'ja' ? 'font-japanese' : 'font-playful';
        const slots = collageSlots(dp.photos.length);
        // Screen cells: square face-centered crop when the URL carries no prior
        // transform; thumbnails (originalImageUrl can be a 200px derivative)
        // pass through untouched rather than upscaling.
        const cellUrl = (url: string) =>
          /\/image\/upload\/v\d/.test(url)
            ? url.replace('/upload/', '/upload/f_auto,q_auto,c_lfill,w_480,h_480,g_auto:faces/')
            : url;
        return (
          <div
            key={`collage-${dp.seq}-${index}`}
            className="overflow-hidden rounded-lg border border-black/15"
            style={{ backgroundColor: '#FFFDF8' }}
          >
            <div className="absolute inset-0">
              {dp.withHeading && (
                <div className="absolute left-0 w-full text-center" style={{ top: 0.55 * scale }}>
                  <p
                    className={`${collageFontClass} font-bold text-[#1a1a1a]`}
                    style={{ fontSize: `${titleSize}px`, margin: 0 }}
                  >
                    {collageTitle} <span style={{ color: '#F76C5E' }}>♥</span>
                  </p>
                  {dp.subline && (
                    <p
                      className={`${collageFontClass} text-[#8a8a8a]`}
                      style={{ fontSize: `${smallBodySize}px`, margin: 0 }}
                    >
                      {dp.subline}
                    </p>
                  )}
                </div>
              )}
              {dp.photos.map((photo, i) => {
                const slot = slots[i];
                const outerW = (slot.windowIn + 0.3) * scale;
                const outerH = (slot.windowIn + 0.7) * scale;
                const left = slot.xIn * scale - outerW / 2;
                const top = (slot.yIn - slot.windowIn / 2 - 0.15) * scale;
                const win = slot.windowIn * scale;
                return (
                  <div
                    key={photo.id}
                    className="absolute bg-white shadow-md"
                    style={{
                      left,
                      top,
                      width: outerW,
                      height: outerH,
                      padding: 0.15 * scale,
                      boxSizing: 'border-box',
                      transform: `rotate(${slot.rotationDeg}deg)`,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={cellUrl(photo.url)}
                      alt=""
                      className="block object-cover"
                      style={{ width: win, height: win }}
                      loading="lazy"
                    />
                  </div>
                );
              })}
              {dp.withMascot && (
                <Image
                  src={MASCOT_CATS_SITTING}
                  alt="Storywink mascot"
                  width={200}
                  height={200}
                  className="absolute object-contain"
                  style={{
                    bottom: 0.45 * scale,
                    right: 0.5 * scale,
                    height: '9%',
                    width: 'auto',
                  }}
                />
              )}
            </div>
          </div>
        );
      }

      // Portrait-only combined page: square art on top, text strip below —
      // the words stay on screen with their picture.
      if (dp.type === 'story') {
        const pageKey = `${dp.page.id}-story-${index}`;
        const storyFontClass = dp.language === 'ja' ? 'font-japanese' : 'font-playful';
        const imageUrl = dp.page.generatedImageUrl;
        const mountImage = shouldMountImage(index);
        return (
          <div key={pageKey} className="overflow-hidden rounded-lg border border-black/15 bg-white">
            <div className="absolute inset-0 flex flex-col">
              {/* The art shrinks before the text clips: the square is capped
                at pageHeight minus 7rem (~4 lines at the 12px floor plus
                padding), so it letterboxes down instead of squeezing the
                text strip out. Sized in px from the same measurements the
                page itself uses — no aspect-ratio/max-height ambiguity. */}
              <div
                className="relative mx-auto aspect-square flex-none overflow-hidden"
                style={{ width: Math.max(48, Math.min(pageWidth, pageHeight - 112)) }}
              >
                {imageUrl ? (
                  <>
                    {renderBlurBackdrop(imageUrl)}
                    {mountImage && (
                      <BookArtImage
                        src={imageUrl}
                        alt={dp.page.text || t('pageAlt', { number: dp.page.pageNumber })}
                        sizes={`(max-width: 768px) 90vw, ${pageWidth}px`}
                        priority={index <= 2}
                        eager
                        fadeIn
                      />
                    )}
                  </>
                ) : (
                  renderCookingPlaceholder()
                )}
              </div>
              {/* Last-resort guard: a pathological long page scrolls inside
                its strip instead of clipping. Never engages at the normal
                12-22px range. */}
              <div className="flex min-h-0 flex-1 [touch-action:pan-y] items-center justify-center overflow-y-auto [overscroll-behavior:contain] px-[8%]">
                {dp.page.text && dp.page.text.trim() && (
                  <p
                    className={`${storyFontClass} text-center leading-snug text-[#1a1a1a]`}
                    style={{ fontSize: `${bodySize}px` }}
                  >
                    {renderStoryText(dp.page)}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      }

      // Existing text/illustration rendering (dp is narrowed to text | illustration here)
      const pageKey = `${dp.page.id}-${dp.type}-${index}`;
      const textFontClass =
        dp.type === 'text' && dp.language === 'ja' ? 'font-japanese' : 'font-playful';

      // Index 0 is the cover slot: show the dedicated painted cover there when
      // it exists. The title page's story render still appears as a story beat.
      const isCoverSlot = dp.type === 'illustration' && index === 0 && dp.page.isTitlePage;
      const imageUrl = (isCoverSlot && coverImageUrl) || dp.page.generatedImageUrl;
      const mountImage = dp.type === 'illustration' && shouldMountImage(index);

      // Portrait pages are taller than the square art (0.78 aspect): the cover
      // letterboxes vertically centered, like a book cover sitting on paper.
      if (dp.type === 'illustration' && layout === 'portrait') {
        return (
          <div key={pageKey} className="overflow-hidden rounded-lg border border-black/15 bg-white">
            {imageUrl ? (
              <div className="absolute inset-0 flex items-center">
                <div className="relative aspect-square w-full overflow-hidden">
                  {renderBlurBackdrop(imageUrl)}
                  {mountImage && (
                    <BookArtImage
                      src={imageUrl}
                      alt={dp.page.text || t('pageAlt', { number: dp.page.pageNumber })}
                      sizes={`(max-width: 768px) 90vw, ${pageWidth}px`}
                      priority={index <= 2}
                      eager
                      fadeIn
                    />
                  )}
                </div>
              </div>
            ) : (
              renderCookingPlaceholder()
            )}
          </div>
        );
      }

      return (
        <div key={pageKey} className="overflow-hidden rounded-lg border border-black/15 bg-white">
          {dp.type === 'text' ? (
            // Text page - white background with centered story text
            <div className="absolute inset-0 flex items-center justify-center p-[10%]">
              <p
                className={`${textFontClass} text-center leading-relaxed text-[#1a1a1a]`}
                style={{ fontSize: `${bodySize}px` }}
              >
                {renderStoryText(dp.page)}
              </p>
            </div>
          ) : imageUrl ? (
            // Illustration page - full image over its blurred tiny backdrop
            <div className="absolute inset-0 overflow-hidden">
              {renderBlurBackdrop(imageUrl)}
              {mountImage && (
                <BookArtImage
                  src={imageUrl}
                  alt={dp.page.text || t('pageAlt', { number: dp.page.pageNumber })}
                  sizes={`(max-width: 768px) 90vw, ${pageWidth}px`}
                  priority={index <= 2}
                  eager
                  fadeIn
                />
              )}
            </div>
          ) : (
            renderCookingPlaceholder()
          )}
        </div>
      );
    };

    return (
      <div
        ref={containerRef}
        className={cn(
          'flex h-full w-full items-center justify-center [&_.stf__item]:rounded-lg',
          className,
        )}
      >
        {pageWidth > 0 && pageHeight > 0 && (
          <div
            style={{
              transform: `translateX(${coverOffset}px)`,
              transition: prefersReducedMotion
                ? 'none'
                : 'transform 0.7s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <HTMLFlipBook
              // Remount on layout change: PageFlip bakes its dimensions and
              // portrait/spread mode in at construction, and the rotation remap
              // lands the reader back on the same beat via onInit.
              key={layout}
              ref={flipBookInternalRef}
              width={pageWidth}
              height={pageHeight}
              size="fixed"

              // Dummy "required" props to satisfy IProps
              className=""
              style={{}}
              startPage={0}
              minWidth={1}
              minHeight={1}
              maxWidth={4096}
              maxHeight={4096}
              startZIndex={0}
              autoSize={true}
              showCover={!isPortrait}
              useMouseEvents={true}
              swipeDistance={30}
              showPageCorners={true}
              // Tap-to-flip stays with the reader's own edge-tap handler (the
              // preview page): the engine keeps only its corner squares.
              disableFlipByClick={true}

              // Real settings
              drawShadow
              maxShadowOpacity={0.7}
              flippingTime={prefersReducedMotion ? 150 : 700}
              usePortrait={isPortrait}
              // Vertical pans pass through to native scroll (a no-op under the
              // reader's body scroll lock); a fold only engages once |dx| > 10.
              mobileScrollSupport={true}
              clickEventForward

              // Event handlers
              onFlip={handleFlip}
              onInit={handleInit}
              onChangeState={handleStateChange}
            >
              {displayPages.map((dp, index) => renderDisplayPage(dp, index))}
            </HTMLFlipBook>
          </div>
        )}
      </div>
    );
  },
);

FlipbookViewer.displayName = 'FlipbookViewer';

export default FlipbookViewer;
