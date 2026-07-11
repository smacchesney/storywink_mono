"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { BookStatus } from '@prisma/client';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Trash2, Eye, AlertTriangle, RefreshCw, Download, Printer, Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { printPageCounts } from '@storywink/shared/collage';
import { isPrintShippableLocale } from '@/lib/print-availability';
import { track } from '@/lib/track';
import { cn } from '@/lib/utils';
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave';
import { Storydust } from '@/components/ui/storydust';
import { PrintOrderSheet, PrintOrderBook } from '@/components/print/PrintOrderSheet';
import { ExportPdfDialog } from '@/components/book/ExportPdfDialog';
import BookArtImage from '@/components/book/BookArtImage';

export interface BookCardProps {
  id: string;
  title: string | null;
  status: BookStatus;
  qcRound?: number;
  updatedAt?: Date | null;
  pageCount?: number;
  coverImageUrl?: string | null;
  onDeleteClick: () => void;
  onRetryClick?: () => void;
  isDeleting?: boolean;
  isRetrying?: boolean;
}

// CSS-only stack of pages peeking out under the cover — the card reads as a
// book object, not a dashboard tile.
const PAGE_STACK_SHADOW =
  '3px 3px 0 -1px #fff, 3px 3px 0 0 #e5e5e5, 6px 6px 0 -1px #fff, 6px 6px 0 0 #d9d9d9';

const COVER_SIZES = '(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw';

const BookCard: React.FC<BookCardProps> = ({
  id,
  title,
  updatedAt: _updatedAt,
  status,
  qcRound = 0,
  pageCount,
  coverImageUrl,
  onDeleteClick,
  onRetryClick,
  isDeleting = false,
  isRetrying = false,
}) => {
  const router = useRouter();
  const t = useTranslations('bookCard');
  const tc = useTranslations('common');
  const tWhatNow = useTranslations('whatNow');
  const locale = useLocale();
  // Where print can actually ship today (SHIPPING_TIERS covers SG/MY). The
  // ja locale keeps an honest "printing comes soon" line in the kebab —
  // never a checkout it can't finish — and the PDF takes the footer slot.
  const printShippable = isPrintShippableLocale(locale);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showPrintSheet, setShowPrintSheet] = useState(false);
  const [printInterestSent, setPrintInterestSent] = useState(false);

  const handlePrintInterest = () => {
    if (printInterestSent) return;
    setPrintInterestSent(true);
    track('print_interest', { bookId: id, props: { locale, surface: 'bookCard' } });
  };

  const actualPageCount = pageCount ?? 0;
  const displayTitle = title || t('untitledBook');
  const displayImageUrl = coverImageUrl;

  const isCompleted = status === BookStatus.COMPLETED;
  const isPartial = status === BookStatus.PARTIAL;
  const isFailed = status === BookStatus.FAILED;
  const isDraft = status === BookStatus.DRAFT;
  const isStoryReady = status === BookStatus.STORY_READY;
  const isWriting = status === BookStatus.GENERATING;
  const isIllustrating = status === BookStatus.ILLUSTRATING;
  const isWorking = isWriting || isIllustrating;

  // The cover tap is the one primary action; it goes where the book needs
  // the parent next.
  const coverHref = isCompleted || isPartial || isFailed
    ? `/book/${id}/preview`
    : isStoryReady
      ? `/create/review?bookId=${id}`
      : `/create/${id}/setup`;

  // Prepare book data for PrintOrderSheet
  const printOrderBook: PrintOrderBook = {
    id,
    title,
    coverImageUrl: coverImageUrl ?? null,
    pageCount: printPageCounts(
      actualPageCount,
      process.env.NEXT_PUBLIC_COLLAGE_PAGES_ENABLED === 'true'
    ).interiorPages,
  };

  const caption = isDraft
    ? t('continueMaking')
    : isStoryReady
      ? t('storyReady')
      : isIllustrating
        ? t('availableWhenComplete')
        : null;

  return (
    <>
      <Card className="flex h-full flex-col gap-0 p-3 hover:shadow-md transition-shadow">
        {/* Cover — square, page-stack edge, the whole thing is the tap target */}
        <Link
          href={coverHref}
          aria-label={t('coverAlt', { title: displayTitle })}
          className="group relative block w-full aspect-square rounded-md overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2"
          style={{ boxShadow: PAGE_STACK_SHADOW }}
        >
          {displayImageUrl ? (
            <BookArtImage
              src={displayImageUrl}
              alt=""
              sizes={COVER_SIZES}
              className={isWorking ? 'blur-sm scale-105' : 'transition-transform duration-200 group-hover:scale-[1.02]'}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-700 dark:to-slate-800 flex items-center justify-center">
              <span className="text-xs text-muted-foreground">{t('noPreview')}</span>
            </div>
          )}

          {/* Working overlay: the shimmer names what's happening right now */}
          {isWorking && (
            <>
              <div className="absolute inset-0 bg-black/40" />
              <div className="absolute inset-0 flex flex-col items-center justify-center space-y-1 px-3 text-center">
                <Storydust variant="twinkle" size="inline" className="text-white" />
                <TextShimmerWave
                  className="text-sm font-semibold font-playful [--base-color:#e2e8f0] [--base-gradient-color:var(--coral-primary)]"
                  duration={1}
                  spread={1}
                  zDistance={1}
                  scaleDistance={1.1}
                  rotateYDistance={20}
                >
                  {isWriting
                    ? t('writingStory')
                    : qcRound > 0
                      ? t('polishingIllustrations')
                      : t('creatingIllustrations')}
                </TextShimmerWave>
                {isIllustrating && (
                  <p className="text-xs text-white/90">
                    {qcRound > 0 ? t('almostDone') : t('usuallyTakes')}
                  </p>
                )}
              </div>
            </>
          )}
        </Link>

        {/* Title row + the one kebab (all secondary actions live here) */}
        <div className="mt-3 flex items-center justify-between gap-1">
          <CardTitle className="text-base font-playful min-w-0 break-words leading-snug">{displayTitle}</CardTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={isDeleting}
                className="h-8 w-8 shrink-0 text-muted-foreground"
              >
                {isDeleting ? (
                  <Storydust variant="twinkle" size="inline" />
                ) : (
                  <MoreHorizontal className="h-4 w-4" />
                )}
                <span className="sr-only">{t('bookActions')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isCompleted && (
                <>
                  {printShippable ? (
                    <DropdownMenuItem onClick={() => setShowPrintSheet(true)}>
                      <Printer className="mr-2 h-4 w-4" /> {t('orderPrint')}
                    </DropdownMenuItem>
                  ) : (
                    // Honest replacement where "Order Print" used to sit:
                    // one tap registers interest, the item stays open to
                    // say thanks. Reuses the whatNow copy so every surface
                    // speaks the same line.
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        handlePrintInterest();
                      }}
                      className={cn(
                        'max-w-[15rem] text-xs',
                        printInterestSent ? 'text-coral focus:text-coral' : 'text-muted-foreground',
                      )}
                    >
                      <Printer className="mr-2 h-4 w-4 shrink-0" />
                      {printInterestSent ? tWhatNow('printThanks') : tWhatNow('printSoon')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setShowExportDialog(true)}>
                    <Download className="mr-2 h-4 w-4" /> {t('savePdf')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {isPartial && (
                <>
                  <DropdownMenuItem onClick={() => router.push(`/book/${id}/resolve`)}>
                    <RefreshCw className="mr-2 h-4 w-4" /> {t('fixIssues')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {isFailed && onRetryClick && (
                <>
                  <DropdownMenuItem onClick={onRetryClick} disabled={isRetrying}>
                    <RefreshCw className="mr-2 h-4 w-4" /> {isRetrying ? t('retrying') : t('retryIllustrations')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
                onClick={onDeleteClick}
                disabled={isDeleting}
              >
                <Trash2 className="mr-2 h-4 w-4" /> {tc('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Status line, only where the book needs a word */}
        {caption && (
          <p className="mt-1 text-sm font-playful text-[var(--ink-soft)] line-clamp-2">{caption}</p>
        )}
        {(isPartial || isFailed) && (
          <p className="mt-1 flex items-center gap-1 text-xs text-coral">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {isFailed ? t('illustrationFailed') : t('someIllustrationsFailed')}
          </p>
        )}

        {/* Footer buttons return at tall md+ viewports, where cards are wide
            enough for them; `mt-auto` keeps every card's buttons on a shared
            baseline whatever the title/status above them did. */}
        {isCompleted && (
          <div className="mt-auto pt-3 hidden tall:md:flex items-center gap-2">
            <Button
              onClick={() => router.push(`/book/${id}/preview`)}
              size="sm"
              variant="outline"
              className="flex-1 rounded-full font-playful"
            >
              <Eye className="h-4 w-4 mr-1.5" />
              {t('view')}
            </Button>
            {printShippable ? (
              <Button
                onClick={() => setShowPrintSheet(true)}
                size="sm"
                className="flex-1 bg-coral hover:bg-[#E55A4C] rounded-full font-playful"
              >
                <Printer className="h-4 w-4 mr-1.5" />
                {t('orderPrint')}
              </Button>
            ) : (
              // Non-shippable locales get the deliverable they CAN have.
              <Button
                onClick={() => setShowExportDialog(true)}
                size="sm"
                className="flex-1 bg-coral hover:bg-[#E55A4C] rounded-full font-playful"
              >
                <Download className="h-4 w-4 mr-1.5" />
                {t('savePdf')}
              </Button>
            )}
          </div>
        )}
        {isPartial && (
          <div className="mt-auto pt-3 hidden tall:md:flex">
            <Button
              onClick={() => router.push(`/book/${id}/resolve`)}
              size="sm"
              className="flex-1 bg-coral hover:bg-[#E55A4C] rounded-full font-playful"
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              {t('fixIssues')}
            </Button>
          </div>
        )}
        {isFailed && (
          <div className="mt-auto pt-3 hidden tall:md:flex">
            <Button
              onClick={onRetryClick}
              size="sm"
              disabled={isRetrying}
              className="flex-1 bg-coral hover:bg-[#E55A4C] rounded-full font-playful"
            >
              {isRetrying ? (
                <Storydust variant="twinkle" size="inline" className="mr-1.5 text-white" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1.5" />
              )}
              {isRetrying ? t('retrying') : t('retryIllustrations')}
            </Button>
          </div>
        )}
        {isDraft && (
          <div className="mt-auto pt-3 hidden tall:md:flex">
            <Button
              onClick={() => router.push(`/create/${id}/setup`)}
              size="sm"
              className="flex-1 bg-coral hover:bg-[#E55A4C] rounded-full font-playful"
            >
              <Pencil className="h-4 w-4 mr-1.5" />
              {t('continueMaking')}
            </Button>
          </div>
        )}
        {isStoryReady && (
          <div className="mt-auto pt-3 hidden tall:md:flex">
            <Button
              onClick={() => router.push(`/create/review?bookId=${id}`)}
              size="sm"
              className="flex-1 bg-coral hover:bg-[#E55A4C] rounded-full font-playful"
            >
              <Eye className="h-4 w-4 mr-1.5" />
              {t('takeALook')}
            </Button>
          </div>
        )}
      </Card>

      {isCompleted && (
        <>
          {/* Print Order Sheet — mounted only where print can ship */}
          {printShippable && (
            <PrintOrderSheet
              book={printOrderBook}
              isOpen={showPrintSheet}
              onClose={() => setShowPrintSheet(false)}
            />
          )}

          {/* PDF export: fetches, shows the wait, auto-saves when ready */}
          <ExportPdfDialog
            bookId={id}
            bookTitle={title}
            open={showExportDialog}
            onOpenChange={setShowExportDialog}
          />
        </>
      )}
    </>
  );
};

export default BookCard;
