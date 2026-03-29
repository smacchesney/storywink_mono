"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { BookStatus } from '@prisma/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
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
  Pencil,
  Paintbrush,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@clerk/nextjs';
import { CloudinaryUploaderAuto } from '@/components/cloudinary-uploader-auto';
import { useTranslations } from 'next-intl';

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

const MASCOT_URL = 'https://res.cloudinary.com/storywink/image/upload/v1772291377/Screenshot_2026-02-28_at_10.58.09_PM_gnknk5.png';

/** Determine if a page needs work */
function pageNeedsWork(p: PageData): boolean {
  if (p.isTitlePage) return false;
  if (p.moderationStatus === 'FLAGGED') return true;
  if (!p.generatedImageUrl && p.moderationStatus !== 'OK') return true;
  return false;
}

/** Determine what step a page is at based on its DB state */
function detectPageStep(p: PageData): 'choose-action' | 'reviewing-text' | 'illustrating' {
  // FLAGGED = hasn't been touched yet
  if (p.moderationStatus === 'FLAGGED') return 'choose-action';
  // PENDING with text but no illustration = user replaced photo, text was generated, needs illustration
  if (p.text && !p.generatedImageUrl) return 'reviewing-text';
  // PENDING with no text = text is being generated
  if (!p.text && !p.generatedImageUrl) return 'choose-action';
  return 'choose-action';
}

export default function BookResolvePage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const t = useTranslations('resolve');
  const bookId = params.bookId as string;

  const [book, setBook] = useState<BookData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showUploader, setShowUploader] = useState(false);
  const [generatedText, setGeneratedText] = useState('');
  const [isGeneratingText, setIsGeneratingText] = useState(false);
  const [isIllustrating, setIsIllustrating] = useState(false);
  const [newIllustrationUrl, setNewIllustrationUrl] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<'choose-action' | 'uploading' | 'reviewing-text' | 'illustrating' | 'done'>('choose-action');

  // Refs for polling cleanup
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isIllustratingRef = useRef(false);

  useEffect(() => { isIllustratingRef.current = isIllustrating; }, [isIllustrating]);

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

  // Pages needing work (derived from book state)
  const pagesNeedingWork = book?.pages.filter(pageNeedsWork) || [];
  const selectedPage = pagesNeedingWork[currentIndex] || null;

  // Fetch book data
  const fetchBook = useCallback(async () => {
    try {
      const response = await fetch(`/api/book/${bookId}`);
      if (!response.ok) throw new Error('Failed to fetch book');
      const data: BookData = await response.json();

      if (data.status !== BookStatus.PARTIAL) {
        router.replace(`/book/${bookId}/preview`);
        return;
      }

      setBook(data);
    } catch {
      toast.error('Failed to load book');
    } finally {
      setIsLoading(false);
    }
  }, [bookId, router]);

  useEffect(() => { fetchBook(); }, [fetchBook]);

  // On initial load or when book changes, auto-detect step for current page
  useEffect(() => {
    if (!selectedPage || activeStep === 'uploading' || activeStep === 'illustrating' || activeStep === 'done') return;
    const detected = detectPageStep(selectedPage);
    setActiveStep(detected);
    if (detected === 'reviewing-text' && selectedPage.text) {
      setGeneratedText(selectedPage.text);
      setIsGeneratingText(false);
    }
  }, [selectedPage?.id, selectedPage?.moderationStatus, selectedPage?.text, selectedPage?.generatedImageUrl]);

  // Navigation between issue pages
  const goToPage = (index: number) => {
    clearPolling();
    setCurrentIndex(index);
    setActiveStep('choose-action');
    setGeneratedText('');
    setIsGeneratingText(false);
    setIsIllustrating(false);
    setNewIllustrationUrl(null);
  };

  const goNext = () => { if (currentIndex < pagesNeedingWork.length - 1) goToPage(currentIndex + 1); };
  const goPrev = () => { if (currentIndex > 0) goToPage(currentIndex - 1); };

  // --- Remove Page ---
  const handleRemovePage = async () => {
    if (!selectedPage || !book) return;
    setIsDeleting(true);
    try {
      const token = await getToken();
      const response = await fetch(`/api/book/${bookId}/page/${selectedPage.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to remove page');
      }
      toast.success(t('pageRemoved'));
      setShowDeleteDialog(false);
      // Adjust index if we removed the last item
      if (currentIndex >= pagesNeedingWork.length - 1 && currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
      }
      await fetchBook();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  // --- Replace Photo: Upload ---
  const handleReplaceClick = () => {
    setActiveStep('uploading');
    setShowUploader(true);
  };

  const handleUploadComplete = async (assets: any[]) => {
    setShowUploader(false);
    if (!assets.length || !selectedPage) return;

    setActiveStep('reviewing-text');
    setIsGeneratingText(true);

    try {
      const token = await getToken();
      const assetResponse = await fetch('/api/cloudinary/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assets }),
      });
      if (!assetResponse.ok) throw new Error('Failed to create asset record');
      const assetData = await assetResponse.json();
      const newAssetId = assetData.data.assets[0].id;

      const replaceResponse = await fetch(`/api/book/${bookId}/page/${selectedPage.id}/replace-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assetId: newAssetId }),
      });
      if (!replaceResponse.ok) throw new Error('Failed to replace photo');

      fetchBook();

      const textResponse = await fetch('/api/generate/story/page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookId, pageId: selectedPage.id }),
      });
      if (!textResponse.ok) throw new Error('Failed to start text generation');

      const pageIdToWatch = selectedPage.id;
      pollIntervalRef.current = setInterval(async () => {
        try {
          const bookRes = await fetch(`/api/book/${bookId}`);
          const bookData = await bookRes.json();
          const page = bookData.pages.find((p: PageData) => p.id === pageIdToWatch);
          if (page?.text) {
            clearPolling();
            setGeneratedText(page.text);
            setIsGeneratingText(false);
            setBook(bookData);
          }
        } catch { /* keep polling */ }
      }, 3000);

      pollTimeoutRef.current = setTimeout(() => {
        clearPolling();
        setIsGeneratingText(false);
        toast.error(t('textGenerationTimeout'));
        setActiveStep('choose-action');
      }, 60000);
    } catch (err: any) {
      toast.error(err.message);
      setActiveStep('choose-action');
      setIsGeneratingText(false);
    }
  };

  const handleUploadCancel = () => {
    setShowUploader(false);
    setActiveStep('choose-action');
  };

  // --- Confirm Text + Illustrate ---
  const handleConfirmText = async () => {
    if (!selectedPage) return;
    try {
      const token = await getToken();
      const response = await fetch(`/api/book/${bookId}/page/${selectedPage.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: generatedText }),
      });
      if (!response.ok) throw new Error('Failed to save text');

      setActiveStep('illustrating');
      setIsIllustrating(true);

      const illResponse = await fetch('/api/generate/illustrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookId, pageIds: [selectedPage.id] }),
      });
      if (!illResponse.ok) throw new Error('Failed to start illustration');

      const pageIdToWatch = selectedPage.id;
      pollIntervalRef.current = setInterval(async () => {
        try {
          const bookRes = await fetch(`/api/book/${bookId}`);
          const bookData = await bookRes.json();
          const page = bookData.pages.find((p: PageData) => p.id === pageIdToWatch);

          if (page?.generatedImageUrl && page.moderationStatus === 'OK') {
            clearPolling();
            setNewIllustrationUrl(page.generatedImageUrl);
            setIsIllustrating(false);
            setActiveStep('done');
            setBook(bookData);
          } else if (page?.moderationStatus === 'FLAGGED') {
            clearPolling();
            setIsIllustrating(false);
            toast.error(t('illustrationFlaggedAgain'));
            setActiveStep('choose-action');
            setBook(bookData);
          }
        } catch { /* keep polling */ }
      }, 5000);

      pollTimeoutRef.current = setTimeout(() => {
        clearPolling();
        if (isIllustratingRef.current) {
          setIsIllustrating(false);
          toast.error(t('illustrationTimeout'));
          setActiveStep('choose-action');
        }
      }, 180000);
    } catch (err: any) {
      toast.error(err.message);
      setActiveStep('choose-action');
    }
  };

  // --- Done: advance or view book ---
  const handleNextOrViewBook = async () => {
    const response = await fetch(`/api/book/${bookId}`);
    const data: BookData = await response.json();
    if (data.status === BookStatus.COMPLETED) {
      router.push(`/book/${bookId}/preview`);
    } else {
      setBook(data);
      const remaining = data.pages.filter(pageNeedsWork);
      setCurrentIndex(0);
      setActiveStep(remaining.length > 0 ? 'choose-action' : 'choose-action');
      setNewIllustrationUrl(null);
      setGeneratedText('');
      // If no more pages need work, redirect
      if (remaining.length === 0) {
        router.push(`/book/${bookId}/preview`);
      }
    }
  };

  // --- Loading ---
  if (isLoading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-[#F76C5E]" />
        <p className="text-muted-foreground font-playful">{t('loading')}</p>
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

  const selectedPhotoUrl = selectedPage?.asset?.thumbnailUrl || selectedPage?.asset?.url || selectedPage?.originalImageUrl;

  return (
    <div className="min-h-screen px-4 py-8 max-w-2xl mx-auto">
      {/* Header with mascot */}
      <div className="text-center mb-6">
        <Image src={MASCOT_URL} alt="" width={120} height={120} className="mx-auto mb-3 h-16 w-16 md:h-20 md:w-20" />
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-playful">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">{t('subtitle', { count: pagesNeedingWork.length })}</p>
      </div>

      {/* Page Grid */}
      <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 mb-6">
        {book.pages.filter((p) => !p.isTitlePage).map((page) => {
          const needsWork = pageNeedsWork(page);
          const isSelected = selectedPage?.id === page.id;
          const indexInIssues = pagesNeedingWork.findIndex(p => p.id === page.id);
          return needsWork ? (
            <button
              key={page.id}
              onClick={() => goToPage(indexInIssues)}
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
          ) : (
            <div key={page.id} className="relative aspect-square rounded-lg overflow-hidden border-2 border-green-200">
              {page.generatedImageUrl || page.originalImageUrl ? (
                <Image src={page.generatedImageUrl || page.originalImageUrl || ''} alt={`Page ${page.pageNumber}`} fill className="object-cover" sizes="60px" />
              ) : (
                <div className="w-full h-full bg-gray-100" />
              )}
              <div className="absolute top-0.5 right-0.5"><Check className="h-3 w-3 text-green-600" /></div>
              <span className="absolute bottom-0 left-0 right-0 text-[10px] text-center bg-black/40 text-white">{page.pageNumber}</span>
            </div>
          );
        })}
      </div>

      {/* Page Navigation (prev/next between issue pages) */}
      {pagesNeedingWork.length > 0 && selectedPage && (
        <div className="flex items-center justify-between mb-4 px-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={goPrev}
            disabled={currentIndex === 0}
            className="text-slate-500 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            {t('prevPage')}
          </Button>
          <span className="text-sm font-medium text-slate-600">
            {t('pageXofY', { current: currentIndex + 1, total: pagesNeedingWork.length })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={goNext}
            disabled={currentIndex === pagesNeedingWork.length - 1}
            className="text-slate-500 disabled:opacity-30"
          >
            {t('nextPage')}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Action Card — driven by activeStep */}
      {selectedPage && activeStep === 'choose-action' && (
        <Card className="border-amber-200 bg-amber-50/50 overflow-hidden">
          <CardContent className="pt-6 px-4 sm:px-6">
            <div className="flex items-start gap-3 sm:gap-4">
              <div className="relative w-20 h-20 rounded-lg overflow-hidden shrink-0 border">
                {selectedPhotoUrl ? (
                  <Image src={selectedPhotoUrl} alt={`Page ${selectedPage.pageNumber}`} fill className="object-cover" sizes="80px" />
                ) : (
                  <div className="w-full h-full bg-gray-200" />
                )}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-900">
                  {t('pageNeedsAttention', { page: selectedPage.pageNumber })}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('photoCouldntBeIllustrated')}
                </p>
                <div className="flex flex-col sm:flex-row gap-2 mt-4">
                  <Button onClick={handleReplaceClick} className="w-full sm:flex-1 bg-[#F76C5E] hover:bg-[#E55A4C] text-white rounded-full font-playful">
                    <ImagePlus className="h-4 w-4 mr-1.5" />
                    {t('replacePhoto')}
                  </Button>
                  <Button variant="outline" onClick={() => setShowDeleteDialog(true)} className="w-full sm:flex-1 rounded-full font-playful border-slate-300 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200">
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    {t('removePage')}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Uploading */}
      {activeStep === 'uploading' && showUploader && (
        <CloudinaryUploaderAuto onUploadComplete={handleUploadComplete} onCancel={handleUploadCancel} />
      )}

      {/* Reviewing Text */}
      {activeStep === 'reviewing-text' && selectedPage && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-4">
              <Pencil className="h-5 w-5 text-[#F76C5E]" />
              <h3 className="font-semibold text-slate-900">{t('reviewStory')}</h3>
            </div>
            {isGeneratingText ? (
              <div className="flex items-center gap-3 py-8 justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-[#F76C5E]" />
                <p className="text-muted-foreground font-playful">{t('writingStory')}</p>
              </div>
            ) : (
              <>
                <Textarea value={generatedText} onChange={(e) => setGeneratedText(e.target.value)} className="min-h-[100px] text-base" placeholder={t('storyTextPlaceholder')} />
                <p className="text-xs text-muted-foreground mt-2">{t('editIfNeeded')}</p>
                <Button onClick={handleConfirmText} className="mt-4 w-full bg-[#F76C5E] hover:bg-[#E55A4C] text-white rounded-full font-playful">
                  <Check className="h-4 w-4 mr-1.5" />
                  {t('looksGood')}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Illustrating */}
      {activeStep === 'illustrating' && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-4">
              <Paintbrush className="h-5 w-5 text-[#F76C5E]" />
              <h3 className="font-semibold text-slate-900">{t('creatingIllustration')}</h3>
            </div>
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[#F76C5E]" />
              <p className="text-muted-foreground font-playful">{t('illustrating')}</p>
              <p className="text-xs text-muted-foreground">{t('usuallyAboutAMinute')}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Done */}
      {activeStep === 'done' && newIllustrationUrl && (() => {
        const remaining = pagesNeedingWork.filter(p => p.id !== selectedPage?.id).length;
        return (
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="relative w-48 h-48 mx-auto rounded-lg overflow-hidden mb-4 border">
                <Image src={newIllustrationUrl} alt="New illustration" fill className="object-cover" sizes="192px" />
              </div>
              <h3 className="font-semibold text-slate-900 mb-1 font-playful">{t('pageFixed')}</h3>
              {remaining > 0 && (
                <p className="text-sm text-muted-foreground mb-4">{t('pagesRemaining', { count: remaining })}</p>
              )}
              <Button onClick={handleNextOrViewBook} className="bg-[#F76C5E] hover:bg-[#E55A4C] text-white rounded-full font-playful">
                {remaining > 0 ? t('fixNextPage') : t('viewBook')}
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </CardContent>
          </Card>
        );
      })()}

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removePageTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('removePageDescription', { page: selectedPage?.pageNumber || 0 })}</AlertDialogDescription>
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
