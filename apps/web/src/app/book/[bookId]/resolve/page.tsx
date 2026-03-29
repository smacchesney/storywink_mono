"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { BookStatus } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Check,
  AlertTriangle,
  Trash2,
  ImagePlus,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@clerk/nextjs';
import { CloudinaryUploaderAuto } from '@/components/cloudinary-uploader-auto';
import { useTranslations } from 'next-intl';
import PageCard from '@/components/create/review/PageCard';
import NavigationControls from '@/components/create/review/NavigationControls';

interface PageData {
  id: string;
  pageNumber: number;
  assetId: string | null;
  originalImageUrl: string | null;
  generatedImageUrl: string | null;
  moderationStatus: string;
  isTitlePage: boolean;
  text: string | null;
  textConfirmed: boolean | null;
  asset?: { url: string; thumbnailUrl: string | null } | null;
}

interface BookData {
  id: string;
  title: string | null;
  status: BookStatus;
  coverAssetId: string | null;
  pages: PageData[];
}

type ResolvePhase = 'fix-photos' | 'generating-text' | 'review-text';

const MASCOT_URL = 'https://res.cloudinary.com/storywink/image/upload/v1772291377/Screenshot_2026-02-28_at_10.58.09_PM_gnknk5.png';

/** Determine if a page needs work based on its DB state */
function pageNeedsWork(p: PageData): boolean {
  if (p.isTitlePage) return false;
  if (p.moderationStatus === 'FLAGGED') return true;
  if (!p.generatedImageUrl && p.moderationStatus !== 'OK') return true;
  return false;
}

/** SessionStorage helpers — persist replacedPageIds across refreshes */
function loadReplacedPageIds(bookId: string): string[] {
  try {
    const stored = sessionStorage.getItem(`resolve-${bookId}-replaced`);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function saveReplacedPageIds(bookId: string, ids: string[]) {
  try { sessionStorage.setItem(`resolve-${bookId}-replaced`, JSON.stringify(ids)); } catch {}
}

function clearReplacedPageIds(bookId: string) {
  try { sessionStorage.removeItem(`resolve-${bookId}-replaced`); } catch {}
}

export default function BookResolvePage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const t = useTranslations('resolve');
  const bookId = params.bookId as string;

  // Phase
  const [phase, setPhase] = useState<ResolvePhase>('fix-photos');

  // Book data
  const [book, setBook] = useState<BookData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // fix-photos phase
  const [currentFixIndex, setCurrentFixIndex] = useState(0);
  const [replacedPageIds, setReplacedPageIds] = useState<string[]>(() => loadReplacedPageIds(bookId));
  const [showUploader, setShowUploader] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [pageToDelete, setPageToDelete] = useState<PageData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // generating-text phase
  const [isGeneratingText, setIsGeneratingText] = useState(false);
  const [textGenTimedOut, setTextGenTimedOut] = useState(false);

  // review-text phase
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);
  const [confirmed, setConfirmed] = useState<boolean[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Polling refs
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasDetectedPhase = useRef(false);

  // Persist replacedPageIds to sessionStorage on change
  useEffect(() => {
    saveReplacedPageIds(bookId, replacedPageIds);
  }, [bookId, replacedPageIds]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  const clearPolling = () => {
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null; }
  };

  // --- Derived state ---
  // Actionable pages: pages that need work AND haven't been replaced yet
  const actionablePages = book?.pages.filter(
    p => pageNeedsWork(p) && !replacedPageIds.includes(p.id)
  ) || [];
  const selectedFixPage = actionablePages[currentFixIndex] || null;
  const allPagesFixed = actionablePages.length === 0 && replacedPageIds.length > 0;

  // For review phase: get the actual page data for replaced pages
  const replacedPages = book?.pages.filter(p => replacedPageIds.includes(p.id)) || [];
  const currentReviewPage = replacedPages[currentReviewIndex] || null;
  const allConfirmed = confirmed.length > 0 && confirmed.every(c => c);

  // --- Fetch book data ---
  const fetchBook = useCallback(async () => {
    try {
      setFetchError(null);
      const response = await fetch(`/api/book/${bookId}`);
      if (!response.ok) throw new Error('Failed to fetch book');
      const data: BookData = await response.json();
      setBook(data);
    } catch (err: any) {
      setFetchError(err.message || 'Failed to load book');
    } finally {
      setIsLoading(false);
    }
  }, [bookId]);

  useEffect(() => { fetchBook(); }, [fetchBook]);

  // --- Route guard: redirect if book is not PARTIAL ---
  useEffect(() => {
    if (book && book.status !== BookStatus.PARTIAL) {
      router.replace(`/book/${bookId}/preview`);
    }
  }, [book, bookId, router]);

  // --- Phase detection on initial load (for resume after refresh) ---
  useEffect(() => {
    if (!book || hasDetectedPhase.current) return;
    hasDetectedPhase.current = true;

    const stored = loadReplacedPageIds(bookId);
    if (stored.length === 0) return; // No prior progress — stay in fix-photos

    // Validate stored IDs still exist in book
    const validIds = stored.filter(id => book.pages.some(p => p.id === id));
    if (validIds.length === 0) {
      clearReplacedPageIds(bookId);
      return;
    }

    // Check if all replaced pages have text → go to review-text
    const allHaveText = validIds.every(id => {
      const page = book.pages.find(p => p.id === id);
      return page?.text;
    });

    if (allHaveText) {
      setReplacedPageIds(validIds);
      setConfirmed(validIds.map(() => false));
      setPhase('review-text');
      return;
    }

    // Check if all actionable pages are addressed (text gen should be in progress)
    const remaining = book.pages.filter(
      p => pageNeedsWork(p) && !validIds.includes(p.id)
    );
    if (remaining.length === 0) {
      // All flagged pages were addressed, but text isn't ready yet — resume generating
      setReplacedPageIds(validIds);
      setPhase('generating-text');
      setIsGeneratingText(true);
      startTextPolling(validIds);
      return;
    }

    // Otherwise, there are still actionable pages — stay in fix-photos with restored replaced list
    setReplacedPageIds(validIds);
  }, [book]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Clamp currentFixIndex when actionablePages shrinks ---
  useEffect(() => {
    if (currentFixIndex >= actionablePages.length && actionablePages.length > 0) {
      setCurrentFixIndex(actionablePages.length - 1);
    } else if (actionablePages.length === 0) {
      setCurrentFixIndex(0);
    }
  }, [actionablePages.length, currentFixIndex]);

  // --- Navigation between actionable pages ---
  const goToFixPage = (index: number) => {
    setCurrentFixIndex(index);
  };

  // ========== Phase 1: Fix Photos handlers ==========

  const handleRemovePage = async () => {
    if (!pageToDelete || !book) return;
    setIsDeleting(true);
    try {
      const token = await getToken();
      const response = await fetch(`/api/book/${bookId}/page/${pageToDelete.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to remove page');
      }
      toast.success(t('pageRemoved'));
      setShowDeleteDialog(false);
      await fetchBook();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReplaceClick = () => {
    setShowUploader(true);
  };

  const handleUploadComplete = async (assets: any[]) => {
    setShowUploader(false);
    if (!assets.length || !selectedFixPage) return;

    try {
      const token = await getToken();

      // Create asset record
      const assetResponse = await fetch('/api/cloudinary/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assets }),
      });
      if (!assetResponse.ok) {
        const err = await assetResponse.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create asset record');
      }
      const assetData = await assetResponse.json();
      const newAssetId = assetData.data.assets[0].id;

      // Replace photo on the page
      const replaceResponse = await fetch(`/api/book/${bookId}/page/${selectedFixPage.id}/replace-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assetId: newAssetId }),
      });
      if (!replaceResponse.ok) {
        const err = await replaceResponse.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to replace photo');
      }

      // Track this page as replaced (deduplicate)
      setReplacedPageIds(prev => prev.includes(selectedFixPage.id) ? prev : [...prev, selectedFixPage.id]);

      // Refresh book data
      await fetchBook();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleUploadCancel = () => {
    setShowUploader(false);
  };

  // ========== Phase 2: Generating Text handlers ==========

  const startTextPolling = useCallback((pageIds: string[]) => {
    clearPolling();
    setTextGenTimedOut(false);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/book/${bookId}`);
        if (!res.ok) return; // Silently retry on next interval
        const data: BookData = await res.json();
        setBook(data);

        const allHaveText = pageIds.every(pid => {
          const page = data.pages.find(p => p.id === pid);
          return page?.text;
        });

        if (allHaveText) {
          clearPolling();
          setIsGeneratingText(false);
          setConfirmed(pageIds.map(() => false));
          setPhase('review-text');
        }
      } catch {
        // Silently retry on next poll interval
      }
    }, 3000);

    // 90s timeout — show retry, stay in generating-text phase
    pollTimeoutRef.current = setTimeout(() => {
      clearPolling();
      setIsGeneratingText(false);
      setTextGenTimedOut(true);
    }, 90000);
  }, [bookId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerateStory = async () => {
    setPhase('generating-text');
    setIsGeneratingText(true);
    setTextGenTimedOut(false);

    try {
      const token = await getToken();

      // Fire text gen for all replaced pages in parallel
      const results = await Promise.all(
        replacedPageIds.map(pageId =>
          fetch('/api/generate/story/page', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ bookId, pageId }),
          })
        )
      );

      // Check if any requests failed
      const failed = results.find(r => !r.ok);
      if (failed) {
        throw new Error('Failed to start text generation');
      }

      startTextPolling(replacedPageIds);
    } catch (err: any) {
      toast.error(err.message);
      setIsGeneratingText(false);
      setPhase('fix-photos');
    }
  };

  const handleRetryTextGen = () => {
    handleGenerateStory();
  };

  // ========== Phase 3: Review Text handlers ==========

  const handleTextChange = (newText: string) => {
    if (!currentReviewPage) return;

    // Update book state with the new text so it's available for saving
    setBook(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        pages: prev.pages.map(p =>
          p.id === currentReviewPage.id ? { ...p, text: newText } : p
        ),
      };
    });

    // Mark as unconfirmed
    setConfirmed(prev => {
      const copy = [...prev];
      copy[currentReviewIndex] = false;
      return copy;
    });
  };

  const handleConfirm = async () => {
    if (!currentReviewPage) return;
    setIsSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/book/${bookId}/page/${currentReviewPage.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: currentReviewPage.text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save text');
      }

      const newConfirmed = [...confirmed];
      newConfirmed[currentReviewIndex] = true;
      setConfirmed(newConfirmed);

      // Auto-advance to next unconfirmed page
      const nextUnconfirmed = newConfirmed.findIndex((c, i) => !c && i > currentReviewIndex);
      if (nextUnconfirmed !== -1) setCurrentReviewIndex(nextUnconfirmed);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save text');
    } finally {
      setIsSaving(false);
    }
  };

  const handleIllustrate = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const token = await getToken();
      const response = await fetch('/api/generate/illustrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookId, pageIds: replacedPageIds }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to start illustration');
      }
      clearReplacedPageIds(bookId);
      router.push('/library');
    } catch (err: any) {
      toast.error(err.message);
      setIsSubmitting(false);
    }
  };

  // --- Loading state ---
  if (isLoading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-[#F76C5E]" />
        <p className="text-muted-foreground font-playful">{t('loading')}</p>
      </div>
    );
  }

  // --- Error state ---
  if (fetchError) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen gap-4">
        <p className="text-red-600">{fetchError}</p>
        <Button onClick={() => { setFetchError(null); setIsLoading(true); fetchBook(); }} className="bg-[#F76C5E] hover:bg-[#E55A4C] text-white rounded-full font-playful">
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <p className="text-muted-foreground">{t('bookNotFound')}</p>
      </div>
    );
  }

  const selectedPhotoUrl = selectedFixPage?.asset?.thumbnailUrl || selectedFixPage?.asset?.url || selectedFixPage?.originalImageUrl;

  return (
    <div className="min-h-screen px-4 py-8 max-w-2xl mx-auto">
      {/* Header with mascot */}
      <div className="text-center mb-6">
        <Image src={MASCOT_URL} alt="" width={120} height={120} className="mx-auto mb-3 h-16 w-16 md:h-20 md:w-20" />
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-playful">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">
          {phase === 'fix-photos'
            ? t('subtitle', { count: actionablePages.length })
            : phase === 'generating-text'
              ? t('generatingSubtitle')
              : t('reviewSubtitle')}
        </p>
      </div>

      {/* ===== Phase 1: Fix Photos ===== */}
      {phase === 'fix-photos' && (
        <>
          {/* Page Grid */}
          <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 mb-6">
            {book.pages.filter(p => !p.isTitlePage).map((page) => {
              const isReplaced = replacedPageIds.includes(page.id);
              const needsWork = pageNeedsWork(page) && !isReplaced;
              const isSelected = selectedFixPage?.id === page.id;
              const indexInActionable = actionablePages.findIndex(p => p.id === page.id);

              if (needsWork) {
                return (
                  <button
                    key={page.id}
                    onClick={() => goToFixPage(indexInActionable)}
                    aria-label={`Page ${page.pageNumber} - needs attention`}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all cursor-pointer
                      ${isSelected ? 'border-[#F76C5E] ring-2 ring-[#F76C5E]/30' : 'border-amber-400 hover:border-amber-500'}`}
                  >
                    {page.originalImageUrl ? (
                      <Image src={page.originalImageUrl} alt={`Page ${page.pageNumber}`} fill className="object-cover" sizes="60px" />
                    ) : (
                      <div className="w-full h-full bg-gray-100" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center bg-amber-500/20">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                    </div>
                    <span className="absolute bottom-0 left-0 right-0 text-[10px] text-center bg-black/40 text-white">{page.pageNumber}</span>
                  </button>
                );
              }

              // OK or replaced pages — show as addressed
              return (
                <div key={page.id} className={`relative aspect-square rounded-lg overflow-hidden border-2 ${isReplaced ? 'border-[#F76C5E]/40' : 'border-green-200'}`}>
                  {(page.generatedImageUrl || page.originalImageUrl) ? (
                    <Image src={page.generatedImageUrl || page.originalImageUrl || ''} alt={`Page ${page.pageNumber}`} fill className="object-cover" sizes="60px" />
                  ) : (
                    <div className="w-full h-full bg-gray-100" />
                  )}
                  <div className="absolute top-0.5 right-0.5">
                    <Check className={`h-3 w-3 ${isReplaced ? 'text-[#F76C5E]' : 'text-green-600'}`} />
                  </div>
                  <span className="absolute bottom-0 left-0 right-0 text-[10px] text-center bg-black/40 text-white">{page.pageNumber}</span>
                </div>
              );
            })}
          </div>

          {/* Page Navigation (prev/next between actionable pages) */}
          {actionablePages.length > 0 && selectedFixPage && (
            <div className="flex items-center justify-between mb-4 px-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentFixIndex(i => i - 1)}
                disabled={currentFixIndex === 0}
                className="text-slate-500 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                {t('prevPage')}
              </Button>
              <span className="text-sm font-medium text-slate-600">
                {t('pageXofY', { current: currentFixIndex + 1, total: actionablePages.length })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentFixIndex(i => i + 1)}
                disabled={currentFixIndex === actionablePages.length - 1}
                className="text-slate-500 disabled:opacity-30"
              >
                {t('nextPage')}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}

          {/* Action Card — choose Replace or Remove */}
          {selectedFixPage && !showUploader && (
            <Card className="border-amber-200 bg-amber-50/50 overflow-hidden">
              <CardContent className="pt-6 px-4 sm:px-6">
                <div className="flex items-start gap-3 sm:gap-4">
                  <div className="relative w-20 h-20 rounded-lg overflow-hidden shrink-0 border">
                    {selectedPhotoUrl ? (
                      <Image src={selectedPhotoUrl} alt={`Page ${selectedFixPage.pageNumber}`} fill className="object-cover" sizes="80px" />
                    ) : (
                      <div className="w-full h-full bg-gray-200" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-900">
                      {t('pageNeedsAttention', { page: selectedFixPage.pageNumber })}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('photoCouldntBeIllustrated')}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 mt-4">
                      <Button onClick={handleReplaceClick} className="w-full sm:flex-1 bg-[#F76C5E] hover:bg-[#E55A4C] text-white rounded-full font-playful">
                        <ImagePlus className="h-4 w-4 mr-1.5" />
                        {t('replacePhoto')}
                      </Button>
                      <Button variant="outline" onClick={() => { setPageToDelete(selectedFixPage); setShowDeleteDialog(true); }} className="w-full sm:flex-1 rounded-full font-playful border-slate-300 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200">
                        <Trash2 className="h-4 w-4 mr-1.5" />
                        {t('removePage')}
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Cloudinary Uploader */}
          {showUploader && (
            <CloudinaryUploaderAuto onUploadComplete={handleUploadComplete} onCancel={handleUploadCancel} />
          )}

          {/* "Generate Story" button — appears when all pages addressed */}
          {allPagesFixed && (
            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground mb-3 font-playful">{t('allPagesFixed')}</p>
              <Button onClick={handleGenerateStory} className="w-full bg-[#F76C5E] hover:bg-[#E55A4C] text-white rounded-full font-playful text-lg py-6">
                {t('generateStory')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* ===== Phase 2: Generating Text ===== */}
      {phase === 'generating-text' && (
        <Card>
          <CardContent className="pt-6">
            {isGeneratingText ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="h-6 w-6 animate-spin text-[#F76C5E]" />
                <p className="text-muted-foreground font-playful">
                  {t('generatingTextCount', { count: replacedPageIds.length })}
                </p>
              </div>
            ) : textGenTimedOut ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <p className="text-amber-600 font-playful">{t('textGenerationTimeout')}</p>
                <Button onClick={handleRetryTextGen} className="bg-[#F76C5E] hover:bg-[#E55A4C] text-white rounded-full font-playful">
                  {t('retry')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* ===== Phase 3: Review Text ===== */}
      {phase === 'review-text' && currentReviewPage && (
        <>
          {/* PageCard — reused from review flow */}
          <PageCard
            key={currentReviewPage.id}
            id={currentReviewPage.id}
            imageUrl={currentReviewPage.asset?.url || currentReviewPage.originalImageUrl}
            text={currentReviewPage.text}
            pageNumber={currentReviewPage.pageNumber}
            isTitlePage={false}
            isConfirmed={confirmed[currentReviewIndex]}
            isSaving={isSaving}
            bookId={bookId}
            onTextChange={handleTextChange}
            onConfirm={handleConfirm}
          />

          {/* NavigationControls — reused from review flow */}
          <NavigationControls
            currentPage={currentReviewIndex}
            totalPages={replacedPages.length}
            canGoNext={currentReviewIndex < replacedPages.length - 1}
            canGoPrevious={currentReviewIndex > 0}
            isProcessing={isSaving}
            onPrevious={() => setCurrentReviewIndex(i => i - 1)}
            onNext={() => setCurrentReviewIndex(i => i + 1)}
          />

          {/* Illustrate button — below navigation, enabled when all confirmed */}
          <div className="mt-4 pb-4">
            <Button
              onClick={handleIllustrate}
              disabled={!allConfirmed || isSubmitting}
              className="w-full bg-[#F76C5E] hover:bg-[#E55A4C] text-white rounded-full font-playful text-lg py-6 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}
              {t('illustrateBook')}
            </Button>
          </div>
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removePageTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('removePageDescription', { page: pageToDelete?.pageNumber || 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemovePage} disabled={isDeleting} className="bg-red-600 hover:bg-red-700">
              {isDeleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {t('removeConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
