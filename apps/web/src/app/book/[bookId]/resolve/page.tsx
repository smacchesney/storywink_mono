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
  asset?: { url: string; thumbnailUrl: string | null } | null;
}

interface BookData {
  id: string;
  title: string | null;
  status: BookStatus;
  coverAssetId: string | null;
  pages: PageData[];
}

type ResolveStep = 'overview' | 'uploading' | 'reviewing-text' | 'illustrating' | 'done';

// Mascot URL (dedication page cats)
const MASCOT_URL = 'https://res.cloudinary.com/storywink/image/upload/v1772291377/Screenshot_2026-02-28_at_10.58.09_PM_gnknk5.png';

export default function BookResolvePage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const t = useTranslations('resolve');
  const bookId = params.bookId as string;

  const [book, setBook] = useState<BookData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPage, setSelectedPage] = useState<PageData | null>(null);
  const [step, setStep] = useState<ResolveStep>('overview');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showUploader, setShowUploader] = useState(false);
  const [generatedText, setGeneratedText] = useState('');
  const [isGeneratingText, setIsGeneratingText] = useState(false);
  const [isIllustrating, setIsIllustrating] = useState(false);
  const [newIllustrationUrl, setNewIllustrationUrl] = useState<string | null>(null);

  // Refs for polling cleanup
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isIllustratingRef = useRef(false);
  const selectedPageRef = useRef<PageData | null>(null);

  // Keep refs in sync
  useEffect(() => {
    isIllustratingRef.current = isIllustrating;
  }, [isIllustrating]);
  useEffect(() => {
    selectedPageRef.current = selectedPage;
  }, [selectedPage]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  // Fetch book data
  const fetchBook = useCallback(async () => {
    try {
      const response = await fetch(`/api/book/${bookId}`);
      if (!response.ok) throw new Error('Failed to fetch book');
      const data = await response.json();

      // If book is no longer PARTIAL, redirect
      if (data.status !== BookStatus.PARTIAL) {
        router.replace(`/book/${bookId}/preview`);
        return;
      }

      setBook(data);

      // Update selectedPage with fresh data if one is selected
      if (selectedPageRef.current) {
        const updated = data.pages.find((p: PageData) => p.id === selectedPageRef.current!.id);
        setSelectedPage(updated || null);
      } else {
        // Auto-select the first flagged page
        const flagged = data.pages.find((p: PageData) => p.moderationStatus === 'FLAGGED');
        if (flagged) setSelectedPage(flagged);
      }
    } catch {
      toast.error('Failed to load book');
    } finally {
      setIsLoading(false);
    }
  }, [bookId, router]);

  useEffect(() => {
    fetchBook();
  }, [fetchBook]);

  // Pages needing work: FLAGGED or replaced (PENDING with no illustration)
  const flaggedPages = book?.pages.filter(
    (p) => !p.isTitlePage && (
      p.moderationStatus === 'FLAGGED' ||
      (p.moderationStatus === 'PENDING' && !p.generatedImageUrl)
    )
  ) || [];

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
      setSelectedPage(null);
      setShowDeleteDialog(false);
      setStep('overview');
      // Refresh book — may redirect to preview if auto-completed
      await fetchBook();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  // --- Replace Photo: Step 1 - Upload ---
  const handleReplaceClick = () => {
    setStep('uploading');
    setShowUploader(true);
  };

  const handleUploadComplete = async (assets: any[]) => {
    setShowUploader(false);
    if (!assets.length || !selectedPage) return;

    // Immediately show the "Writing your story..." state
    setStep('reviewing-text');
    setIsGeneratingText(true);

    try {
      const token = await getToken();
      // Create asset record
      const assetResponse = await fetch('/api/cloudinary/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assets }),
      });
      if (!assetResponse.ok) throw new Error('Failed to create asset record');
      const assetData = await assetResponse.json();
      const newAssetId = assetData.data.assets[0].id;

      // Replace photo on the page
      const replaceResponse = await fetch(`/api/book/${bookId}/page/${selectedPage.id}/replace-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ assetId: newAssetId }),
      });
      if (!replaceResponse.ok) throw new Error('Failed to replace photo');

      // Refresh book data in background
      fetchBook();

      // Queue text generation (runs in worker)
      const textResponse = await fetch('/api/generate/story/page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookId, pageId: selectedPage.id }),
      });
      if (!textResponse.ok) throw new Error('Failed to start text generation');

      // Poll for text to appear on the page
      const pageIdToWatch = selectedPage.id;
      pollIntervalRef.current = setInterval(async () => {
        try {
          const bookRes = await fetch(`/api/book/${bookId}`);
          const bookData = await bookRes.json();
          const page = bookData.pages.find((p: PageData) => p.id === pageIdToWatch);
          if (page?.text) {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
            setGeneratedText(page.text);
            setIsGeneratingText(false);
          }
        } catch {
          // Keep polling
        }
      }, 3000);

      // Timeout after 60 seconds
      pollTimeoutRef.current = setTimeout(() => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        setIsGeneratingText(false);
        toast.error(t('textGenerationTimeout'));
        setStep('overview');
      }, 60000);
    } catch (err: any) {
      toast.error(err.message);
      setStep('overview');
      setIsGeneratingText(false);
    }
  };

  const handleUploadCancel = () => {
    setShowUploader(false);
    setStep('overview');
  };

  // --- Replace Photo: Step 2 - Confirm Text ---
  const handleConfirmText = async () => {
    if (!selectedPage) return;
    try {
      const token = await getToken();
      // Save the (possibly edited) text
      const response = await fetch(`/api/book/${bookId}/page/${selectedPage.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: generatedText }),
      });
      if (!response.ok) throw new Error('Failed to save text');

      // Move to illustration step
      setStep('illustrating');
      setIsIllustrating(true);

      // Trigger illustration for this single page
      const illResponse = await fetch('/api/generate/illustrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookId, pageIds: [selectedPage.id] }),
      });
      if (!illResponse.ok) throw new Error('Failed to start illustration');

      // Poll for completion
      pollIntervalRef.current = setInterval(async () => {
        try {
          const bookRes = await fetch(`/api/book/${bookId}`);
          const bookData = await bookRes.json();
          const pageId = selectedPageRef.current?.id;
          const page = bookData.pages.find((p: PageData) => p.id === pageId);

          if (page?.generatedImageUrl && page.moderationStatus === 'OK') {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
            setNewIllustrationUrl(page.generatedImageUrl);
            setIsIllustrating(false);
            setStep('done');
          } else if (page?.moderationStatus === 'FLAGGED') {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
            setIsIllustrating(false);
            toast.error(t('illustrationFlaggedAgain'));
            setStep('overview');
            await fetchBook();
          }
        } catch {
          // Keep polling
        }
      }, 5000);

      // Timeout after 3 minutes
      pollTimeoutRef.current = setTimeout(() => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        if (isIllustratingRef.current) {
          setIsIllustrating(false);
          toast.error(t('illustrationTimeout'));
          setStep('overview');
        }
      }, 180000);
    } catch (err: any) {
      toast.error(err.message);
      setStep('overview');
    }
  };

  // --- Done: advance to next flagged page or view book ---
  const handleNextOrViewBook = async () => {
    const response = await fetch(`/api/book/${bookId}`);
    const data = await response.json();
    if (data.status === BookStatus.COMPLETED) {
      router.push(`/book/${bookId}/preview`);
    } else {
      // Still PARTIAL — advance to next flagged page
      setBook(data);
      const nextFlagged = data.pages.find((p: PageData) => p.moderationStatus === 'FLAGGED');
      setSelectedPage(nextFlagged || null);
      setStep('overview');
      setNewIllustrationUrl(null);
      setGeneratedText('');
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
      <div className="text-center mb-8">
        <Image
          src={MASCOT_URL}
          alt=""
          width={120}
          height={120}
          className="mx-auto mb-3 h-16 w-16 md:h-20 md:w-20"
        />
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-playful">
          {t('title')}
        </h1>
        <p className="text-muted-foreground mt-2">
          {t('subtitle', { count: flaggedPages.length })}
        </p>
      </div>

      {/* Page Grid */}
      <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 mb-8">
        {book.pages.filter((p) => !p.isTitlePage).map((page) => {
          const isFlagged = page.moderationStatus === 'FLAGGED';
          const isSelected = selectedPage?.id === page.id;
          return isFlagged ? (
            <button
              key={page.id}
              onClick={() => setSelectedPage(page)}
              aria-label={`Page ${page.pageNumber} - needs attention`}
              className={`
                relative aspect-square rounded-lg overflow-hidden border-2 transition-all cursor-pointer
                ${isSelected
                  ? 'border-[#F76C5E] ring-2 ring-[#F76C5E]/30'
                  : 'border-amber-400 hover:border-amber-500'
                }
              `}
            >
              {page.originalImageUrl ? (
                <Image src={page.originalImageUrl} alt={`Page ${page.pageNumber}`} fill className="object-cover" sizes="60px" />
              ) : (
                <div className="w-full h-full bg-gray-100" />
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-amber-500/20">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>
              <span className="absolute bottom-0 left-0 right-0 text-[10px] text-center bg-black/40 text-white">
                {page.pageNumber}
              </span>
            </button>
          ) : (
            <div
              key={page.id}
              aria-label={`Page ${page.pageNumber} - ready`}
              className="relative aspect-square rounded-lg overflow-hidden border-2 border-green-200"
            >
              {page.generatedImageUrl || page.originalImageUrl ? (
                <Image src={page.generatedImageUrl || page.originalImageUrl || ''} alt={`Page ${page.pageNumber}`} fill className="object-cover" sizes="60px" />
              ) : (
                <div className="w-full h-full bg-gray-100" />
              )}
              <div className="absolute top-0.5 right-0.5">
                <Check className="h-3 w-3 text-green-600" />
              </div>
              <span className="absolute bottom-0 left-0 right-0 text-[10px] text-center bg-black/40 text-white">
                {page.pageNumber}
              </span>
            </div>
          );
        })}
      </div>

      {/* Selected Page Actions */}
      {selectedPage && step === 'overview' && (
        <Card className="border-amber-200 bg-amber-50/50 overflow-hidden">
          <CardContent className="pt-6 px-4 sm:px-6">
            {flaggedPages.length > 1 && (
              <p className="text-xs text-amber-700 mb-3 font-medium">
                {t('tapToSwitch', { current: flaggedPages.findIndex(p => p.id === selectedPage.id) + 1, total: flaggedPages.length })}
              </p>
            )}
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
                  <Button
                    onClick={handleReplaceClick}
                    className="w-full sm:flex-1 bg-[#F76C5E] hover:bg-[#E55A4C] text-white rounded-full font-playful"
                  >
                    <ImagePlus className="h-4 w-4 mr-1.5" />
                    {t('replacePhoto')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowDeleteDialog(true)}
                    className="w-full sm:flex-1 rounded-full font-playful border-slate-300 text-slate-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    {t('removePage')}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Uploading */}
      {step === 'uploading' && showUploader && (
        <CloudinaryUploaderAuto
          onUploadComplete={handleUploadComplete}
          onCancel={handleUploadCancel}
        />
      )}

      {/* Step: Reviewing Text */}
      {step === 'reviewing-text' && selectedPage && (
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
                <Textarea
                  value={generatedText}
                  onChange={(e) => setGeneratedText(e.target.value)}
                  className="min-h-[100px] text-base"
                  placeholder={t('storyTextPlaceholder')}
                />
                <p className="text-xs text-muted-foreground mt-2">{t('editIfNeeded')}</p>
                <Button
                  onClick={handleConfirmText}
                  className="mt-4 w-full bg-[#F76C5E] hover:bg-[#E55A4C] text-white rounded-full font-playful"
                >
                  <Check className="h-4 w-4 mr-1.5" />
                  {t('looksGood')}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step: Illustrating */}
      {step === 'illustrating' && (
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

      {/* Step: Done */}
      {step === 'done' && newIllustrationUrl && (() => {
        const remainingFlagged = flaggedPages.filter(p => p.id !== selectedPage?.id).length;
        return (
          <Card>
            <CardContent className="pt-6 text-center">
              <div className="relative w-48 h-48 mx-auto rounded-lg overflow-hidden mb-4 border">
                <Image src={newIllustrationUrl} alt="New illustration" fill className="object-cover" sizes="192px" />
              </div>
              <h3 className="font-semibold text-slate-900 mb-1 font-playful">{t('pageFixed')}</h3>
              {remainingFlagged > 0 && (
                <p className="text-sm text-muted-foreground mb-4">
                  {t('pagesRemaining', { count: remainingFlagged })}
                </p>
              )}
              <Button
                onClick={handleNextOrViewBook}
                className="bg-[#F76C5E] hover:bg-[#E55A4C] text-white rounded-full font-playful"
              >
                {remainingFlagged > 0 ? t('fixNextPage') : t('viewBook')}
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </CardContent>
          </Card>
        );
      })()}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removePageTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('removePageDescription', { page: selectedPage?.pageNumber || 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemovePage}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              {t('removeConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
