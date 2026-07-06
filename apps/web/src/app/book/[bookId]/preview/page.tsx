'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Book, Page, BookStatus } from '@prisma/client'; // Assuming prisma client types are available
import { Loader2, AlertTriangle, ChevronLeft, ChevronRight, Library, Download, Printer, ArrowLeft, Maximize2, Minimize2, Eye, EyeOff } from 'lucide-react'; // Added fullscreen icons
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import BookPageGallery from '@/components/book/BookPageGallery'; // Import the new component
import FlipbookViewer, { FlipbookActions, buildDisplayPages, type BookLayout } from '@/components/book/FlipbookViewer'; // Import FlipbookViewer, FlipbookActions type, and buildDisplayPages
import BookIssueBanner from '@/components/create/BookIssueBanner';
import GenerationProgress from '@/components/create/GenerationProgress';
import PageControlsMenu from '@/components/book/PageControlsMenu';
import { ExportPdfDialog } from '@/components/book/ExportPdfDialog';
import RevealOverlay from '@/components/book/RevealOverlay';
import WhatNowCard from '@/components/book/WhatNowCard';
import { PrintOrderSheet, PrintOrderBook } from '@/components/print/PrintOrderSheet';
import { calculatePrintedPageCount } from '@storywink/shared';
import { bookContentFingerprint } from '@/lib/book-display';
import { track } from '@/lib/track';
import { cn } from '@/lib/utils';

// Define a type for the book data we expect, including pages
type BookWithPages = Book & { pages: Page[] };

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
  // Where print can actually ship today (Stripe allows SG/MY). The ja locale
  // gets an honest "coming soon" instead of a dead-end checkout.
  const printShippable = locale !== 'ja';
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
  // Add state for fullscreen mode
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Add state for gallery visibility
  const [isGalleryVisible, setIsGalleryVisible] = useState(true);
  // Add state for detecting landscape mode
  const [isLandscape, setIsLandscape] = useState(false);
  // The flipbook auto-detects its layout (combined portrait pages on phones,
  // print-faithful spreads elsewhere) and reports it here so the gallery and
  // footer count stay in lockstep. The initial guess only covers the moment
  // before the first measurement lands.
  const [layout, setLayout] = useState<BookLayout>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'portrait' : 'spread'
  );

  // Add isMountedRef for cleanup safety
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
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

  // Handler for selecting a display page from the gallery (1-based index)
  const handleDisplayPageSelect = (displayIndex: number) => {
    setCurrentDisplayIndex(displayIndex);
    if (flipbookRef.current?.pageFlip) {
       const totalDisplayPages = book ? buildDisplayPages(book.pages, { childName: book.childName, bookTitle: book.title, language: book.language, layout }).length : 1;
       const pageIndex = Math.max(0, Math.min(displayIndex - 1, totalDisplayPages - 1));
       flipbookRef.current.pageFlip().turnToPage(pageIndex);
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

  // Detect orientation changes and landscape mode
  useEffect(() => {
    const checkOrientation = () => {
      const aspectRatio = window.innerWidth / window.innerHeight;
      const isLandscapeMode = window.innerWidth > window.innerHeight && window.innerHeight < 500;
      setIsLandscape(isLandscapeMode);
      
      // Auto-hide gallery in extreme landscape
      if (isLandscapeMode && aspectRatio > 2) {
        setIsGalleryVisible(false);
      }
    };

    checkOrientation();
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);

    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  // Fullscreen toggle handler
  const toggleFullscreen = useCallback(() => {
    const docEl = document.documentElement;
    // iPhone Safari has no Fullscreen API — fall back to a CSS-only
    // immersive mode; all the chrome already keys off this state.
    if (typeof docEl.requestFullscreen !== 'function') {
      setIsFullscreen((prev) => !prev);
      return;
    }
    if (!document.fullscreenElement) {
      docEl.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch((err) => {
        console.error("Error entering fullscreen:", err);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      }).catch((err) => {
        console.error("Error exiting fullscreen:", err);
      });
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Keyboard navigation for the readable book: arrows/space flip, Escape
  // leaves fullscreen (including the CSS fallback, which has no system exit).
  useEffect(() => {
    if (!isReadableStatus(book?.status)) return;
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
      } else if (e.key === 'Escape') {
        // Native fullscreen exits itself and fires fullscreenchange; only
        // the CSS fallback needs a hand here.
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else if (isFullscreen) {
          setIsFullscreen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [book?.status, isFullscreen]);

  // --- Render Logic --- //

  if (isLoading) {
    // Arriving straight from the progress screen: keep the warmth going for
    // the second the data takes, instead of flashing a cold spinner between
    // "Making your book…" and the reveal.
    if (cameFromCompletion) {
      return (
        <div
          className="flex justify-center items-center min-h-screen"
          style={{
            background:
              'radial-gradient(ellipse at 50% 30%, #FFF9F5 0%, #FFFBF5 50%, #FFF5F0 100%)',
          }}
        >
          <Loader2 className="h-8 w-8 animate-spin text-coral" />
        </div>
      );
    }
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-coral" />
        <p className="ml-2 text-muted-foreground">{t('opening')}</p>
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
      <div className="flex flex-col justify-center items-center min-h-screen p-4 text-center">
        <AlertTriangle className="h-10 w-10 mb-3 text-coral" />
        <p className="font-playful text-lg text-gray-800 max-w-xs">{friendlyError}</p>
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
    return <div className="flex justify-center items-center min-h-screen">{t('notFound')}</div>;
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
      <div className="flex flex-col justify-center items-center min-h-screen p-4">
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
    const displayPages = buildDisplayPages(book.pages, { childName: book.childName, bookTitle: book.title, language: book.language, layout });
    const totalDisplayPages = displayPages.length;
    // Disable prev/next based on current display index
    const canFlipPrev = currentDisplayIndex > 1;
    const canFlipNext = currentDisplayIndex < totalDisplayPages;

    // PARTIAL books read like finished ones — the pages that made it are not
    // held hostage by the ones that didn't. A slim strip names the gap.
    const isPartial = book.status === BookStatus.PARTIAL;
    const pagesNeedingLook = isPartial
      ? book.pages.filter(
          (p) => !p.generatedImageUrl || p.moderationStatus === 'FLAGGED' || p.moderationStatus === 'FAILED'
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
      pageCount: calculatePrintedPageCount(book.pages.length),
    };

    // Resolve the current display page back to its source Page so the per-page
    // menu can act on it. Cover/dedication/ending/blank pages have no source
    // page and get no menu. The cover (title page) is left alone by design.
    const currentDisplay = displayPages[currentDisplayIndex - 1];
    const currentSourcePage =
      currentDisplay && (currentDisplay.type === 'illustration' || currentDisplay.type === 'text' || currentDisplay.type === 'story')
        ? currentDisplay.page
        : null;
    const menuPage = currentSourcePage && !currentSourcePage.isTitlePage ? currentSourcePage : null;

    return (
      <div className="flex flex-col h-[100dvh] bg-background">
        {/* Mobile-optimized header - hide in fullscreen */}
        {!isFullscreen && (
          <div className={cn(
            "flex items-center justify-between border-b bg-white transition-all",
            isLandscape ? "p-2" : "p-3"
          )}>
            <Button variant="ghost" size="icon" asChild>
              <Link href="/library" aria-label={t('backToLibrary')}>
                <ArrowLeft className="h-5 w-5 text-coral" />
              </Link>
            </Button>
            <h1 className={cn(
              "font-semibold truncate max-w-[60%]",
              isLandscape ? "text-base" : "text-lg"
            )}>{book.title}</h1>
            <div className="flex items-center gap-1">
              {/* Gallery toggle button for landscape mode */}
              {isLandscape && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsGalleryVisible(!isGalleryVisible)}
                  aria-label={isGalleryVisible ? t('hideGallery') : t('showGallery')}
                >
                  {isGalleryVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              )}
              {/* Fullscreen toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')}
              >
                {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
              <Sheet open={isOptionsSheetOpen} onOpenChange={setIsOptionsSheetOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('options')}>
                    <svg width="18" height="4" viewBox="0 0 18 4" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M2 0C0.9 0 0 0.9 0 2C0 3.1 0.9 4 2 4C3.1 4 4 3.1 4 2C4 0.9 3.1 0 2 0ZM16 0C14.9 0 14 0.9 14 2C14 3.1 14.9 4 16 4C17.1 4 18 3.1 18 2C18 0.9 17.1 0 16 0ZM9 0C7.9 0 7 0.9 7 2C7 3.1 7.9 4 9 4C10.1 4 11 3.1 11 2C11 0.9 10.1 0 9 0Z" fill="currentColor"/>
                    </svg>
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="rounded-t-xl h-auto">
                  <SheetTitle className="sr-only">{t('options')}</SheetTitle>
                  <div className="py-4 space-y-4">
                    <Link href="/library" className="flex items-center gap-2 p-2 hover:bg-muted rounded-md w-full">
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
                        className="flex items-center gap-2 p-2 w-full justify-start"
                      >
                        <Printer className="h-5 w-5 text-coral" />
                        {tWhatNow('orderPrint')}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      onClick={handleExportPdf}
                      disabled={isExportDialogOpen}
                      className="flex items-center gap-2 p-2 w-full justify-start"
                    >
                      <Download className="h-5 w-5 text-coral" />
                      {t('exportPdf')}
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        )}
        
        {/* PARTIAL: slim, warm strip — the rest of the book is readable now */}
        {isPartial && !isFullscreen && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-3 py-2">
            <p className="text-sm text-amber-900 font-playful">
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

        {/* Gallery View - Collapsible in landscape, hidden in fullscreen */}
        {!isFullscreen && isGalleryVisible && (
          <div className={cn(
            "bg-muted/20 border-b shrink-0 transition-all",
            isLandscape ? "px-1 py-1" : "px-2 pt-2 pb-1"
          )}>
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

        {/* Flipbook View - Takes remaining space */}
        <div className="flex-1 relative overflow-hidden min-h-0">
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
          />

          {/* Screen-reader page announcement */}
          <div aria-live="polite" className="sr-only">
            {t('pageOf', { current: currentDisplayIndex, total: totalDisplayPages })}
          </div>

          {/* Exit button for immersive mode — the only way out on iPhone,
              where the CSS fallback has no system gesture or Esc key */}
          {isFullscreen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              aria-label={t('exitFullscreen')}
              className="absolute top-3 right-3 z-10 h-10 w-10 rounded-full bg-background/70 shadow"
            >
              <Minimize2 className="h-5 w-5 text-coral" />
            </Button>
          )}

          {/* Floating Navigation Buttons */}
          <div className="absolute inset-y-0 left-0 flex items-center">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={handlePrevPage}
              disabled={!canFlipPrev}
              aria-label={t('prevPage')}
              className="h-10 w-10 bg-background/70 rounded-r-full shadow"
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
              className="h-10 w-10 bg-background/70 rounded-l-full shadow"
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
        </div>

        {/* Footer with Page Number + per-page menu - Hide in fullscreen */}
        {!isFullscreen && (
          <div className={cn(
            "flex justify-center items-center gap-2 bg-white border-t shrink-0 transition-all relative",
            isLandscape ? "py-1" : "py-2"
          )}>
            <div className="flex items-center bg-muted/20 rounded-full px-4 py-1">
              <span className="text-sm font-medium">
                {t('pageOf', { current: currentDisplayIndex, total: totalDisplayPages })}
              </span>
            </div>
            {menuPage && (
              <div className="absolute right-3">
                <PageControlsMenu
                  bookId={bookId}
                  page={menuPage}
                  onMutated={loadBook}
                />
              </div>
            )}
          </div>
        )}

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
            onOpen={() => setShowReveal(false)}
          />
        )}
      </div>
    );
  }

  // Fallback for any other status (DRAFT, mostly): a gentle nudge back into
  // the create flow instead of a raw status enum.
  return (
    <div className="flex flex-col justify-center items-center min-h-screen p-4 text-center">
      <p className="font-playful text-lg text-gray-800">{t('notReadyTitle')}</p>
      <p className="mt-2 text-sm text-gray-500 max-w-xs">{t('notReadyBody')}</p>
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
        <div className="flex justify-center items-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-coral" />
        </div>
      }
    >
      <BookPreviewContent />
    </Suspense>
  );
}