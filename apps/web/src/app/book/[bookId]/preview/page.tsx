'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Book, Page, BookStatus } from '@prisma/client'; // Assuming prisma client types are available
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Library,
  Download,
  Printer,
  ArrowLeft,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
} from 'lucide-react'; // Added fullscreen icons
import { Button } from '@/components/ui/button';
import { Storydust } from '@/components/ui/storydust';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import BookPageGallery from '@/components/book/BookPageGallery'; // Import the new component
import FlipbookViewer, {
  FlipbookActions,
  buildDisplayPages,
  type BookLayout,
} from '@/components/book/FlipbookViewer'; // Import FlipbookViewer, FlipbookActions type, and buildDisplayPages
import BookIssueBanner from '@/components/create/BookIssueBanner';
import GenerationProgress from '@/components/create/GenerationProgress';
import PageControlsMenu from '@/components/book/PageControlsMenu';
import { ExportPdfDialog } from '@/components/book/ExportPdfDialog';
import RevealOverlay from '@/components/book/RevealOverlay';
import KeepCharacterCard from '@/components/book/KeepCharacterCard';
import WhatNowCard from '@/components/book/WhatNowCard';
import { PrintOrderSheet, PrintOrderBook } from '@/components/print/PrintOrderSheet';
import { printPageCounts } from '@storywink/shared/collage';
import { bookContentFingerprint } from '@/lib/book-display';
import {
  TAP_TRAVEL_PX,
  edgeTapZone,
  galleryDefaultVisible,
  isOnEngineCorner,
  isPhonePortraitViewport,
  isVerticalScrollGesture,
} from '@/components/book/reader-gestures';
import { isPrintShippableLocale } from '@/lib/print-availability';
import { track } from '@/lib/track';

// Define a type for the book data we expect, including pages
type BookWithPages = Book & {
  pages: (Page & { asset?: { id: string; url: string; thumbnailUrl: string | null } | null })[];
};

// Placeholder for a server action or API route call
async function fetchBookData(bookId: string): Promise<BookWithPages | null> {
  // In a real app, this would fetch from your backend
  // Replace with your actual data fetching logic (e.g., call a server action)
  // console.log(`Fetching data for bookId: ${bookId}`); // Keep console.log for debugging if needed
  try {
    // Use the actual API endpoint we just created
    const response = await fetch(`/api/book/${bookId}`);
    if (!response.ok) {
      // Coded errors only — the render maps them to friendly, localized
      // copy. Raw details stay in the log below.
      if (response.status === 404) {
        throw new Error('NOT_FOUND');
      } else if (response.status === 401) {
        throw new Error('UNAUTHORIZED');
      }
      throw new Error(`HTTP_${response.status}`);
    }
    const data = await response.json();
    return data as BookWithPages;
  } catch (error) {
    console.error('Error in fetchBookData:', error);
    // Re-throw the error so the component's catch block can handle it
    throw error;
  }
}

function BookPreviewContent() {
  const params = useParams();
  const bookId = params.bookId as string; // Get bookId from URL
  const t = useTranslations('preview');
  const tIssue = useTranslations('issue');
  const tWhatNow = useTranslations('whatNow');
  const router = useRouter();
  const locale = useLocale();
  // Where print can actually ship today — derived from SHIPPING_TIERS via
  // isPrintShippableLocale, the same gate book-card uses, so every surface
  // lifts together the day a new tier lands.
  const printShippable = isPrintShippableLocale(locale);
  // ?reveal=1 arrives from GenerationProgress on completion. It only bridges
  // the data-loading flash with a warm screen — the reveal itself is gated
  // on firstViewedAt below and the param can never force a repeat.
  const searchParams = useSearchParams();
  const cameFromCompletion = searchParams.get('reveal') === '1';

  const [book, setBook] = useState<BookWithPages | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentDisplayIndex, setCurrentDisplayIndex] = useState<number>(1); // 1-based index into interleaved display pages
  const flipbookRef = useRef<FlipbookActions>(null); // Use FlipbookActions type for ref
  // Add state for the PDF export dialog and the options sheet that launches it
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isOptionsSheetOpen, setIsOptionsSheetOpen] = useState(false);
  // The one-time first-open reveal and the end-of-book "what now" card
  const [showReveal, setShowReveal] = useState(false);
  const [isWhatNowDismissed, setIsWhatNowDismissed] = useState(false);
  const [isPrintSheetOpen, setIsPrintSheetOpen] = useState(false);
  // Native fullscreen only — the fixed overlay already IS the immersive
  // mode, so this button appears solely where the Fullscreen API exists
  // (desktop/Android). iPhone Safari simply never sees it.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  // Gallery visibility: collapsed by default on phone portrait, visible on
  // wider viewports. The default only recomputes until the reader's first
  // manual toggle — an explicit choice wins over rotation.
  const [isGalleryVisible, setIsGalleryVisible] = useState(true);
  const galleryToggledRef = useRef(false);
  // Phone portrait is the layout where the gallery opens as an overlay over
  // the book instead of reflowing it.
  const [isPhonePortrait, setIsPhonePortrait] = useState(false);
  // The flipbook area — tap semantics and the touch guards hang off it.
  const flipAreaRef = useRef<HTMLDivElement>(null);
  const tapStartRef = useRef<{ x: number; y: number } | null>(null);
  // The flipbook auto-detects its layout (combined portrait pages on phones,
  // print-faithful spreads elsewhere) and reports it here so the gallery and
  // footer count stay in lockstep. The initial guess only covers the moment
  // before the first measurement lands.
  const [layout, setLayout] = useState<BookLayout>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'portrait' : 'spread',
  );

  // Add isMountedRef for cleanup safety
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const hasLoadedRef = useRef(false);
  const fingerprintRef = useRef<string | null>(null);

  const loadBook = useCallback(async () => {
    if (!bookId) return;
    try {
      const data = await fetchBookData(bookId);
      if (!isMountedRef.current) return;
      if (data) {
        // Only swap state when the content actually changed. Keeping
        // book.pages referentially stable means the flipbook's displayPages
        // memo holds and react-pageflip never reloads every page mid-read.
        const fingerprint = bookContentFingerprint(data);
        if (fingerprint !== fingerprintRef.current) {
          fingerprintRef.current = fingerprint;
          setBook(data);
        }
        setError(null);
      } else if (!hasLoadedRef.current) {
        setError('NOT_FOUND');
      }
    } catch (err: any) {
      // Refetch failures mid-read are swallowed — the book on screen is
      // intact. Only the initial load surfaces an error (as a code the
      // render maps to friendly copy).
      if (!hasLoadedRef.current && isMountedRef.current) {
        setError(err.message || 'UNKNOWN');
      }
    } finally {
      if (!hasLoadedRef.current && isMountedRef.current) {
        hasLoadedRef.current = true;
        setIsLoading(false);
      }
    }
  }, [bookId]);

  useEffect(() => {
    loadBook();
  }, [loadBook]);

  const isReadableStatus = (status?: BookStatus) =>
    status === BookStatus.COMPLETED || status === BookStatus.PARTIAL;

  // Mark the book as opened once per mount of ANY readable preview (COMPLETED
  // or PARTIAL). The route is idempotent server-side (firstViewedAt only ever
  // set while null), so a PARTIAL read also spends the one-time reveal — a
  // fix-pages completion can never re-reveal a book the parent already read.
  const openedSentRef = useRef(false);
  useEffect(() => {
    if (openedSentRef.current || !isReadableStatus(book?.status)) return;
    openedSentRef.current = true;
    void fetch(`/api/book/${bookId}/opened`, { method: 'POST', keepalive: true }).catch(() => {});
    track('preview_opened', { bookId });
  }, [book?.status, bookId]);

  // The reveal decision is made exactly once, from the server value of
  // firstViewedAt as fetched (the opened POST above only mutates the server,
  // never this snapshot). COMPLETED + never-viewed → reveal. Anything else —
  // PARTIAL first reads, revisits, single-page re-illustrations finishing
  // mid-session — decides "no" and stays decided.
  const revealDecidedRef = useRef(false);
  useEffect(() => {
    if (revealDecidedRef.current || !book || !isReadableStatus(book.status)) return;
    revealDecidedRef.current = true;
    if (book.status === BookStatus.COMPLETED && book.firstViewedAt == null) {
      setShowReveal(true);
    }
  }, [book]);

  // X6a promotion: after the reveal, offer to keep the book's star as an
  // account character. Once per book (decline persists locally), never when
  // an avatar was already promoted from this book.
  const [keepCharacter, setKeepCharacter] = useState<{ characterId: string; name: string } | null>(
    null,
  );
  const [showKeepCharacter, setShowKeepCharacter] = useState(false);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AVATARS_ENABLED !== 'true' || !book) return;
    if (book.status !== BookStatus.COMPLETED) return;
    // X6d: an avatar-story cast is already on the shelf — never offer to
    // re-keep a character that came FROM the character library.
    if (book.bookType === 'AVATAR_STORY') return;
    try {
      if (localStorage.getItem(`keep-character-declined-${book.id}`)) return;
    } catch {
      /* storage unavailable — offer anyway */
    }
    const identity = book.characterIdentity as {
      characters?: Array<{ characterId: string; role: string; name?: string | null }>;
    } | null;
    const star = identity?.characters?.find((c) => c.role === 'main_child');
    if (!star) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch('/api/avatars').catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as {
        avatars: Array<{ promotedFromBookId?: string | null }>;
      };
      if (cancelled) return;
      if (data.avatars.some((a) => a.promotedFromBookId === book.id)) return;
      setKeepCharacter({
        characterId: star.characterId,
        name: (star.name ?? book.childName ?? book.title) || 'your star',
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [book]);

  // Real-moments collage (flag-gated): original photos for the flipbook's
  // scatter page(s). Uses the Asset relation the GET route already includes.
  const collagePhotos = useMemo(
    () =>
      process.env.NEXT_PUBLIC_COLLAGE_PAGES_ENABLED === 'true' && book
        ? book.pages.filter((p) => p.asset?.url).map((p) => ({ id: p.id, url: p.asset!.url }))
        : undefined,
    [book],
  );
  const collageOptions = collagePhotos
    ? { collagePhotos, collageCreatedAt: book?.createdAt ?? null }
    : {};

  // Handler for selecting a display page from the gallery (1-based index)
  const handleDisplayPageSelect = (displayIndex: number) => {
    setCurrentDisplayIndex(displayIndex);
    if (flipbookRef.current?.pageFlip) {
      const totalDisplayPages = book
        ? buildDisplayPages(book.pages, {
            childName: book.childName,
            bookTitle: book.title,
            language: book.language,
            layout,
            ...collageOptions,
          }).length
        : 1;
      const pageIndex = Math.max(0, Math.min(displayIndex - 1, totalDisplayPages - 1));
      flipbookRef.current.pageFlip().turnToPage(pageIndex);
    }
    // The phone-portrait gallery is an overlay; picking a page dismisses it.
    if (isPhonePortrait) {
      setIsGalleryVisible(false);
    }
  };

  // Handler for when the page changes within the Flipbook component (receives 1-based display index)
  const handleFlipbookPageChange = (displayIndex: number) => {
    setCurrentDisplayIndex(displayIndex);
  };

  // --- Flipbook Control Handlers ---

  const handlePrevPage = () => {
    if (flipbookRef.current?.pageFlip) {
      flipbookRef.current.pageFlip().flipPrev();
      // onFlip event in FlipbookViewer will update currentPageNumber state
    }
  };

  const handleNextPage = () => {
    if (flipbookRef.current?.pageFlip) {
      flipbookRef.current.pageFlip().flipNext();
      // onFlip event in FlipbookViewer will update currentPageNumber state
    }
  };

  // --- PDF Export Handler ---
  // ExportPdfDialog owns the whole flow: fetch → blob → auto-save, with a
  // real "preparing" wait and the error toast. This just swaps the sheets.
  const handleExportPdf = () => {
    if (!bookId) return;
    setIsOptionsSheetOpen(false);
    setIsExportDialogOpen(true);
  };

  // Track viewport shape: phone-portrait drives the gallery overlay mode,
  // and the gallery's default visibility follows rotation until the reader
  // toggles it by hand.
  useEffect(() => {
    const checkViewport = () => {
      setIsPhonePortrait(isPhonePortraitViewport(window.innerWidth, window.innerHeight));
      if (!galleryToggledRef.current) {
        setIsGalleryVisible(galleryDefaultVisible(window.innerWidth, window.innerHeight));
      }
    };

    checkViewport();
    window.addEventListener('resize', checkViewport);
    window.addEventListener('orientationchange', checkViewport);

    return () => {
      window.removeEventListener('resize', checkViewport);
      window.removeEventListener('orientationchange', checkViewport);
    };
  }, []);

  const isReadable = isReadableStatus(book?.status);

  // Body scroll lock while the reading overlay is up: nothing behind it can
  // rubber-band into view, and vertical pans that page-flip lets through
  // become no-ops instead of scrolling the page underneath.
  useEffect(() => {
    if (!isReadable) return;
    const docEl = document.documentElement;
    const prevOverflow = docEl.style.overflow;
    const prevOverscroll = docEl.style.overscrollBehavior;
    docEl.style.overflow = 'hidden';
    docEl.style.overscrollBehavior = 'none';
    return () => {
      docEl.style.overflow = prevOverflow;
      docEl.style.overscrollBehavior = prevOverscroll;
    };
  }, [isReadable]);

  // Native fullscreen only where the API exists (desktop/Android). The
  // fullscreen target is the document, not the overlay element, so portaled
  // sheets and dialogs (which live on <body>) stay visible in fullscreen.
  useEffect(() => {
    setCanFullscreen(
      typeof document !== 'undefined' &&
        document.fullscreenEnabled === true &&
        typeof document.documentElement.requestFullscreen === 'function',
    );
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.error('Error entering fullscreen:', err);
      });
    } else {
      document.exitFullscreen().catch((err) => {
        console.error('Error exiting fullscreen:', err);
      });
    }
  }, []);

  // Listen for fullscreen changes (covers Esc and system exits)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Keyboard navigation for the readable book: arrows/space flip. Native
  // fullscreen handles its own Escape.
  useEffect(() => {
    if (!isReadable) return;
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        flipbookRef.current?.pageFlip()?.flipNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        flipbookRef.current?.pageFlip()?.flipPrev();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isReadable]);

  // Vertical-scroll guard (capture phase, before page-flip's window-level
  // touchend): a drag that was clearly a scroll attempt clears the engine's
  // touch state via the public userStop(pos, true) so its corner exception
  // can't turn the page on release. See reader-gestures.ts for the trace.
  useEffect(() => {
    if (!isReadable) return;
    const el = flipAreaRef.current;
    if (!el) return;
    let start: { x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      start = t ? { x: t.clientX, y: t.clientY } : null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      start = null;
      if (isVerticalScrollGesture(dx, dy)) {
        try {
          flipbookRef.current?.pageFlip()?.userStop({ x: 0, y: 0 }, true);
        } catch {
          // The engine may not be live mid-remount; nothing to suppress then.
        }
      }
    };
    el.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    el.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart, { capture: true });
      el.removeEventListener('touchend', onTouchEnd, { capture: true });
    };
  }, [isReadable]);

  // Our own tap semantics (the engine's tap-to-flip is off): a still tap on
  // the left/right third turns the page, the middle third belongs to
  // reading. Buttons, links, and the engine's own corner squares are left
  // alone — corners still fold-and-flip via page-flip itself.
  const handleTapPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    tapStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleTapClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const start = tapStartRef.current;
      tapStartRef.current = null;
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) >= TAP_TRAVEL_PX) return;
      if ((e.target as Element).closest('button, a')) return;
      const container = flipAreaRef.current;
      if (!container) return;
      // Stay out of page-flip's corner squares — it flips those itself.
      const block = container.querySelector('.stf__block');
      if (block) {
        const rect = block.getBoundingClientRect();
        const pageWidth = layout === 'portrait' ? rect.width : rect.width / 2;
        if (
          isOnEngineCorner(
            e.clientX - rect.left,
            e.clientY - rect.top,
            rect.width,
            rect.height,
            pageWidth,
          )
        ) {
          return;
        }
      }
      const areaRect = container.getBoundingClientRect();
      const zone = edgeTapZone((e.clientX - areaRect.left) / areaRect.width);
      if (zone === 'prev') {
        flipbookRef.current?.pageFlip()?.flipPrev();
      } else if (zone === 'next') {
        flipbookRef.current?.pageFlip()?.flipNext();
      }
    },
    [layout],
  );

  const handleGalleryToggle = useCallback(() => {
    galleryToggledRef.current = true;
    setIsGalleryVisible((prev) => !prev);
  }, []);

  // --- Render Logic --- //

  if (isLoading) {
    // Arriving straight from the progress screen: keep the warmth going for
    // the second the data takes, instead of flashing a cold spinner between
    // "Making your book…" and the reveal.
    if (cameFromCompletion) {
      return (
        <div className="bg-waiting flex min-h-screen items-center justify-center">
          <Storydust variant="twinkle" size="card" label={t('opening')} />
        </div>
      );
    }
    return (
      <div className="bg-waiting flex min-h-screen items-center justify-center">
        <Storydust variant="twinkle" size="card" label={t('opening')} showLabel />
      </div>
    );
  }

  if (error) {
    // The error state holds a code; the parent only ever reads friendly copy.
    const friendlyError =
      error === 'UNAUTHORIZED'
        ? t('signInToSee')
        : error === 'NOT_FOUND'
          ? t('notFound')
          : t('loadError');
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
        <AlertTriangle className="mb-3 h-10 w-10 text-coral" />
        <p className="max-w-xs font-playful text-lg text-gray-800">{friendlyError}</p>
        <Button
          asChild
          className="mt-6 rounded-full bg-coral px-6 font-playful text-white hover:bg-coral/90"
        >
          <Link href="/library">{t('backToLibrary')}</Link>
        </Button>
      </div>
    );
  }

  if (!book) {
    return <div className="flex min-h-screen items-center justify-center">{t('notFound')}</div>;
  }

  // --- Status-Based Rendering --- //

  // In-flight states all share the one branded wait. GenerationProgress owns
  // the polling; when the book turns readable it refreshes this page in
  // place, and a book parked at STORY_READY routes itself to review.
  if (
    book.status === BookStatus.GENERATING ||
    book.status === BookStatus.STORY_READY ||
    book.status === BookStatus.ILLUSTRATING
  ) {
    return <GenerationProgress bookId={bookId} onComplete={() => loadBook()} />;
  }

  if (book.status === BookStatus.FAILED) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <BookIssueBanner
            bookId={bookId}
            status={BookStatus.FAILED}
            onRetryStarted={() => {
              // Retry flips the book back into a working state on the server;
              // reload so the in-flight branch mounts the progress screen.
              loadBook();
            }}
          />
        </div>
      </div>
    );
  }

  if (isReadableStatus(book.status)) {
    const displayPages = buildDisplayPages(book.pages, {
      childName: book.childName,
      bookTitle: book.title,
      language: book.language,
      layout,
      ...collageOptions,
    });
    const totalDisplayPages = displayPages.length;
    // Disable prev/next based on current display index
    const canFlipPrev = currentDisplayIndex > 1;
    const canFlipNext = currentDisplayIndex < totalDisplayPages;

    // PARTIAL books read like finished ones — the pages that made it are not
    // held hostage by the ones that didn't. A slim strip names the gap.
    const isPartial = book.status === BookStatus.PARTIAL;
    const pagesNeedingLook = isPartial
      ? book.pages.filter(
          (p) =>
            !p.generatedImageUrl ||
            p.moderationStatus === 'FLAGGED' ||
            p.moderationStatus === 'FAILED',
        ).length || 1
      : 0;

    // The "what now" beat appears at the last spread / back cover, only on a
    // finished book, and never on top of the reveal.
    const atBackCover = currentDisplayIndex >= totalDisplayPages - 1;
    const showWhatNow =
      !isPartial && atBackCover && !isWhatNowDismissed && !showReveal && !isExportDialogOpen;

    const printOrderBook: PrintOrderBook = {
      id: book.id,
      title: book.title,
      coverImageUrl: book.coverImageUrl ?? null,
      pageCount: printPageCounts(
        book.pages.length,
        process.env.NEXT_PUBLIC_COLLAGE_PAGES_ENABLED === 'true',
      ).interiorPages,
    };

    // Resolve the current display page back to its source Page so the per-page
    // menu can act on it. Cover/dedication/ending/blank pages have no source
    // page and get no menu. The cover (title page) is left alone by design.
    const currentDisplay = displayPages[currentDisplayIndex - 1];
    const currentSourcePage =
      currentDisplay &&
      (currentDisplay.type === 'illustration' ||
        currentDisplay.type === 'text' ||
        currentDisplay.type === 'story')
        ? currentDisplay.page
        : null;
    const menuPage = currentSourcePage && !currentSourcePage.isTitlePage ? currentSourcePage : null;

    // The reader escapes the site chrome entirely: a fixed, portaled overlay
    // above the sticky header (which sits in <main>'s z-10 stacking context,
    // so the portal to <body> is what actually clears it). 100vh first as
    // the iOS <15.4 fallback; dvh takes over wherever it exists.
    const reader = (
      <div className="fixed inset-x-0 top-0 z-[60] flex h-[100vh] flex-col bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] supports-[height:100dvh]:h-[100dvh]">
        {/* Slim reader header — static, calm, always there */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b bg-white px-1">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/library" aria-label={t('backToLibrary')}>
              <ArrowLeft className="h-5 w-5 text-coral" />
            </Link>
          </Button>
          <h1 className="max-w-[60%] truncate font-playful text-base font-semibold">
            {book.title}
          </h1>
          <div className="flex items-center gap-1">
            {/* Gallery toggle — always rendered; on phones it opens the
                overlay strip, elsewhere it collapses the in-flow one */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleGalleryToggle}
              aria-label={isGalleryVisible ? t('hideGallery') : t('showGallery')}
            >
              {isGalleryVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            {/* Native fullscreen only — the overlay is already immersive, so
                iPhone Safari (no Fullscreen API) simply has no button */}
            {canFullscreen && (
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>
            )}
            <Sheet open={isOptionsSheetOpen} onOpenChange={setIsOptionsSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('options')}>
                  <svg
                    width="18"
                    height="4"
                    viewBox="0 0 18 4"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M2 0C0.9 0 0 0.9 0 2C0 3.1 0.9 4 2 4C3.1 4 4 3.1 4 2C4 0.9 3.1 0 2 0ZM16 0C14.9 0 14 0.9 14 2C14 3.1 14.9 4 16 4C17.1 4 18 3.1 18 2C18 0.9 17.1 0 16 0ZM9 0C7.9 0 7 0.9 7 2C7 3.1 7.9 4 9 4C10.1 4 11 3.1 11 2C11 0.9 10.1 0 9 0Z"
                      fill="currentColor"
                    />
                  </svg>
                </Button>
              </SheetTrigger>
              {/* z-[70]: portaled surfaces must clear the z-[60] reader */}
              <SheetContent side="bottom" className="z-[70] h-auto rounded-t-xl">
                <SheetTitle className="sr-only">{t('options')}</SheetTitle>
                <div className="space-y-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <Link
                    href="/library"
                    className="flex w-full items-center gap-2 rounded-md p-2 hover:bg-muted"
                  >
                    <Library className="h-5 w-5 text-coral" />
                    <span>{t('backToLibrary')}</span>
                  </Link>
                  {/* Persistent print entry point — only where we can ship. */}
                  {printShippable && !isPartial && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setIsOptionsSheetOpen(false);
                        setIsPrintSheetOpen(true);
                      }}
                      className="flex w-full items-center justify-start gap-2 p-2"
                    >
                      <Printer className="h-5 w-5 text-coral" />
                      {tWhatNow('orderPrint')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={handleExportPdf}
                    disabled={isExportDialogOpen}
                    className="flex w-full items-center justify-start gap-2 p-2"
                  >
                    <Download className="h-5 w-5 text-coral" />
                    {t('exportPdf')}
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* PARTIAL: slim, warm strip — the rest of the book is readable now */}
        {isPartial && (
          <div className="flex items-center justify-between gap-3 border-b border-peach bg-[var(--cream-yellow)] px-3 py-2">
            <p className="font-playful text-sm text-coral-ink">
              {t('partialNote', { count: pagesNeedingLook })}
            </p>
            <Button
              size="sm"
              onClick={() => router.push(`/book/${bookId}/resolve`)}
              className="shrink-0 rounded-full bg-coral px-4 font-playful text-white hover:bg-coral/90"
            >
              {tIssue('fixPages')}
            </Button>
          </div>
        )}

        {/* Gallery strip, in-flow — tablets and desktop, where there's room */}
        {!isPhonePortrait && isGalleryVisible && (
          <div className="shrink-0 border-b bg-muted/20 px-2 pt-2 pb-1">
            <BookPageGallery
              pages={book.pages}
              bookStatus={book.status}
              currentDisplayIndex={currentDisplayIndex}
              onDisplayPageSelect={handleDisplayPageSelect}
              childName={book.childName}
              bookTitle={book.title}
              language={book.language}
              layout={layout}
            />
          </div>
        )}

        {/* Flipbook View - Takes remaining space. The container owns tap
            semantics: edge thirds turn pages, the middle third does nothing. */}
        <div
          ref={flipAreaRef}
          className="relative min-h-0 flex-1 overflow-hidden"
          onPointerDown={handleTapPointerDown}
          onClick={handleTapClick}
        >
          <FlipbookViewer
            ref={flipbookRef}
            pages={book.pages}
            coverImageUrl={book.coverImageUrl}
            initialPageNumber={currentDisplayIndex}
            onPageChange={handleFlipbookPageChange}
            onLayoutChange={setLayout}
            className="absolute inset-0"
            childName={book.childName}
            bookTitle={book.title}
            language={book.language}
            collagePhotos={collagePhotos}
            collageCreatedAt={book.createdAt}
          />

          {/* Screen-reader page announcement */}
          <div aria-live="polite" className="sr-only">
            {t('pageOf', { current: currentDisplayIndex, total: totalDisplayPages })}
          </div>

          {/* Floating Navigation Buttons */}
          <div className="absolute inset-y-0 left-0 flex items-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePrevPage}
              disabled={!canFlipPrev}
              aria-label={t('prevPage')}
              className="h-10 w-10 rounded-r-full bg-background/70 shadow"
            >
              <ChevronLeft className="h-6 w-6 text-coral" />
            </Button>
          </div>
          <div className="absolute inset-y-0 right-0 flex items-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNextPage}
              disabled={!canFlipNext}
              aria-label={t('nextPage')}
              className="h-10 w-10 rounded-l-full bg-background/70 shadow"
            >
              <ChevronRight className="h-6 w-6 text-coral" />
            </Button>
          </div>

          {/* End-of-book "what now" — anchored low so the waving cats on the
              back cover stay fully in view; slides away on flip-back. */}
          {!isPartial && (
            <WhatNowCard
              bookId={bookId}
              visible={showWhatNow}
              printShippable={printShippable}
              onReadAgain={() => {
                flipbookRef.current?.pageFlip()?.turnToPage(0);
                setCurrentDisplayIndex(1);
              }}
              onOrderPrint={() => setIsPrintSheetOpen(true)}
              onSavePdf={handleExportPdf}
              onDismiss={() => setIsWhatNowDismissed(true)}
            />
          )}

          {/* Phone-portrait gallery: an overlay over the book, never a
              reflow. A transparent scrim closes it on tap and swallows the
              event so the book underneath doesn't flip. */}
          {isPhonePortrait && isGalleryVisible && (
            <>
              <div
                aria-hidden="true"
                className="absolute inset-0 z-10"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsGalleryVisible(false);
                }}
              />
              <div
                className="absolute inset-x-0 bottom-0 z-20 animate-in border-t bg-background/95 backdrop-blur duration-200 fade-in-0 motion-safe:slide-in-from-bottom-4"
                onClick={(e) => e.stopPropagation()}
              >
                <BookPageGallery
                  pages={book.pages}
                  bookStatus={book.status}
                  currentDisplayIndex={currentDisplayIndex}
                  onDisplayPageSelect={handleDisplayPageSelect}
                  childName={book.childName}
                  bookTitle={book.title}
                  language={book.language}
                  layout={layout}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer with Page Number + per-page menu — padded past the home
            indicator so the pill stays tappable in every bar state */}
        <div className="relative flex shrink-0 items-center justify-center gap-2 border-t bg-white pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center rounded-full bg-muted/20 px-4 py-1">
            <span className="text-sm font-medium">
              {t('pageOf', { current: currentDisplayIndex, total: totalDisplayPages })}
            </span>
          </div>
          {menuPage && (
            <div className="absolute right-3">
              <PageControlsMenu bookId={bookId} page={menuPage} onMutated={loadBook} />
            </div>
          )}
        </div>

        {/* PDF export: fetches, shows the wait, auto-saves when ready */}
        <ExportPdfDialog
          bookId={bookId}
          bookTitle={book.title}
          open={isExportDialogOpen}
          onOpenChange={setIsExportDialogOpen}
        />

        {/* Print checkout — mounted here so both the what-now card and the
            options sheet can open it. */}
        <PrintOrderSheet
          book={printOrderBook}
          isOpen={isPrintSheetOpen}
          onClose={() => setIsPrintSheetOpen(false)}
        />

        {/* The one-time reveal: the cover rises in over the mounted book;
            one tap dismisses and the parent turns the first page themselves. */}
        {showReveal && (
          <RevealOverlay
            coverImageUrl={book.coverImageUrl}
            childName={book.childName}
            bookTitle={book.title}
            onOpen={() => {
              setShowReveal(false);
              if (keepCharacter) setShowKeepCharacter(true);
            }}
          />
        )}
        {showKeepCharacter && keepCharacter && book && (
          <KeepCharacterCard
            bookId={book.id}
            characterId={keepCharacter.characterId}
            childName={keepCharacter.name}
            onDismiss={() => {
              setShowKeepCharacter(false);
              try {
                localStorage.setItem(`keep-character-declined-${book.id}`, '1');
              } catch {
                /* fine */
              }
            }}
          />
        )}
      </div>
    );

    // Portal to <body>: the overlay must escape <main>'s z-10 stacking
    // context or the sticky site header (z-50) paints over the reader.
    // This branch only renders client-side (after the fetch), so document
    // is always available here.
    return createPortal(reader, document.body);
  }

  // Fallback for any other status (DRAFT, mostly): a gentle nudge back into
  // the create flow instead of a raw status enum.
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <p className="font-playful text-lg text-gray-800">{t('notReadyTitle')}</p>
      <p className="mt-2 max-w-xs text-sm text-gray-500">{t('notReadyBody')}</p>
      <Button
        asChild
        className="mt-6 rounded-full bg-coral px-6 font-playful text-white hover:bg-coral/90"
      >
        <Link href={`/create/${bookId}/setup`}>{t('continueSetup')}</Link>
      </Button>
    </div>
  );
}

// useSearchParams requires a Suspense boundary at build time (same pattern
// as the review page).
export default function BookPreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-waiting flex min-h-screen items-center justify-center">
          <Storydust variant="twinkle" size="card" />
        </div>
      }
    >
      <BookPreviewContent />
    </Suspense>
  );
}
