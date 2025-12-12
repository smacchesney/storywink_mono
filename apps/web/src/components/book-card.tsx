"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { BookStatus, Page } from '@prisma/client';
import {
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Trash2, Eye, Loader2, AlertTriangle, RefreshCw, Download, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { coolifyImageUrl } from '@storywink/shared';
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave';
import { PrintOrderSheet, PrintOrderBook } from '@/components/print/PrintOrderSheet';

export interface BookCardProps {
  id: string;
  title: string | null;
  status: BookStatus;
  updatedAt?: Date | null;
  pages?: Page[];
  pageCount?: number;
  coverImageUrl?: string | null;
  onDeleteClick: () => void;
  onRetryClick?: () => void;
  isDeleting?: boolean;
  isRetrying?: boolean;
}

const BookCard: React.FC<BookCardProps> = ({
  id,
  title,
  updatedAt: _updatedAt,
  status,
  pages,
  pageCount,
  coverImageUrl,
  onDeleteClick,
  onRetryClick,
  isDeleting = false,
  isRetrying = false,
}) => {
  const router = useRouter();
  const [isExporting, setIsExporting] = useState(false);
  const [showPrintSheet, setShowPrintSheet] = useState(false);

  // Calculate page count from pages array or use explicit pageCount
  const actualPageCount = pageCount ?? pages?.length ?? 0;

  const handleViewClick = () => {
    router.push(`/book/${id}/preview`);
  };

  const handleExportPdf = async () => {
    setIsExporting(true);
    try {
      // Open PDF in new tab - the API handles the download
      window.open(`/api/book/${id}/export/pdf`, '_blank');
    } finally {
      // Reset after a short delay
      setTimeout(() => setIsExporting(false), 1000);
    }
  };

  const isIllustrating = status === BookStatus.ILLUSTRATING;
  const isError = status === BookStatus.FAILED || status === BookStatus.PARTIAL;

  const displayImageUrl = coverImageUrl;

  // ILLUSTRATING STATE - Consistent layout with completed cards
  if (isIllustrating) {
    return (
      <Card className="flex flex-col hover:shadow-md transition-shadow overflow-hidden">
        {/* Image area with blur and shimmer overlay */}
        <div className="relative w-full aspect-video bg-muted overflow-hidden">
          {displayImageUrl ? (
            <Image
              src={coolifyImageUrl(displayImageUrl)}
              alt={`${title || 'Book'} cover`}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 45vw, 25vw"
              className="object-cover blur-sm scale-105"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
          )}
          {/* Dark overlay */}
          <div className="absolute inset-0 bg-black/40" />

          {/* Centered shimmer text and time estimate on image */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <TextShimmerWave
              className="text-lg font-semibold font-playful [--base-color:#e2e8f0] [--base-gradient-color:#F76C5E]"
              duration={1}
              spread={1}
              zDistance={1}
              scaleDistance={1.1}
              rotateYDistance={20}
            >
              Creating illustrations...
            </TextShimmerWave>
            <p className="text-sm text-white/70 mt-2">
              This may take 3-5 minutes
            </p>
          </div>
        </div>

        {/* Content below image - matches completed card structure */}
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-lg truncate text-center">{title || 'Untitled Book'}</CardTitle>
        </CardHeader>

        {/* Footer with disabled buttons */}
        <CardFooter className="flex flex-col items-stretch pt-2 px-4 pb-3 gap-2">
          <div className="flex justify-between items-center w-full">
            <Button
              disabled
              size="sm"
              className="flex-grow mr-2 bg-slate-300 hover:bg-slate-300 text-slate-500 cursor-not-allowed rounded-full font-playful"
            >
              <Eye className="h-4 w-4 mr-1.5" />
              View Preview
            </Button>
            <Button variant="outline" size="icon" disabled className="cursor-not-allowed">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Book Actions</span>
            </Button>
          </div>
          <p className="text-xs text-slate-400 text-center">
            Available when illustrations complete
          </p>
        </CardFooter>
      </Card>
    );
  }

  // ERROR STATE - Consistent layout with completed cards
  if (isError) {
    return (
      <Card className="flex flex-col hover:shadow-md transition-shadow overflow-hidden border-red-200 dark:border-red-900">
        {/* Image */}
        <div className="relative w-full aspect-video bg-muted overflow-hidden">
          {displayImageUrl ? (
            <Image
              src={coolifyImageUrl(displayImageUrl)}
              alt={`${title || 'Book'} cover`}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 45vw, 25vw"
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-xs text-muted-foreground">No Preview</span>
            </div>
          )}
        </div>

        {/* Content below image */}
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-lg truncate text-center">{title || 'Untitled Book'}</CardTitle>
          <div className="flex items-center justify-center gap-1.5 text-red-600 dark:text-red-400 mt-1">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">
              {status === BookStatus.FAILED ? 'Illustration failed' : 'Some illustrations failed'}
            </span>
          </div>
        </CardHeader>

        {/* Footer with retry and delete buttons - aligned with completed cards */}
        <CardFooter className="flex justify-between items-center pt-2 px-4 pb-3">
          <Button
            onClick={onRetryClick}
            size="sm"
            className="flex-grow mr-2 bg-[#F76C5E] hover:bg-[#E55A4C] rounded-full font-playful"
            disabled={isRetrying}
          >
            {isRetrying ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1.5" />
            )}
            {isRetrying ? 'Retrying...' : 'Retry Illustrations'}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onDeleteClick}
            disabled={isDeleting}
            className="text-red-600 border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            <span className="sr-only">Delete</span>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // Prepare book data for PrintOrderSheet
  const printOrderBook: PrintOrderBook = {
    id,
    title,
    coverImageUrl: coverImageUrl ?? null,
    pageCount: actualPageCount,
  };

  // COMPLETED STATE - Simplified card without status badge
  return (
    <>
      <Card className="flex flex-col hover:shadow-md transition-shadow overflow-hidden">
        {/* Image */}
        <div className="relative w-full aspect-video bg-muted overflow-hidden">
          {displayImageUrl ? (
            <Image
              src={coolifyImageUrl(displayImageUrl)}
              alt={`${title || 'Book'} cover`}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 45vw, 25vw"
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-xs text-muted-foreground">No Preview</span>
            </div>
          )}
        </div>

        {/* Content below image */}
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-lg truncate text-center">{title || 'Untitled Book'}</CardTitle>
        </CardHeader>

        {/* Footer with View, Order Print, and dropdown */}
        <CardFooter className="flex flex-col gap-2 pt-2 px-4 pb-3">
          {/* Primary actions row */}
          <div className="flex justify-between items-center w-full gap-2">
            <Button
              onClick={handleViewClick}
              size="sm"
              variant="outline"
              className="flex-1 rounded-full font-playful"
            >
              <Eye className="h-4 w-4 mr-1.5" />
              View
            </Button>
            <Button
              onClick={() => setShowPrintSheet(true)}
              size="sm"
              className="flex-1 bg-[#F76C5E] hover:bg-[#E55A4C] rounded-full font-playful"
            >
              <Printer className="h-4 w-4 mr-1.5" />
              Order Print
            </Button>
          </div>

          {/* Secondary actions row */}
          <div className="flex justify-end w-full">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" disabled={isDeleting || isExporting} className="text-muted-foreground">
                  {isDeleting || isExporting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreHorizontal className="h-4 w-4" />
                  )}
                  <span className="sr-only">Book Actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportPdf} disabled={isExporting}>
                  <Download className="mr-2 h-4 w-4" /> Export PDF
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive focus:bg-destructive/10"
                  onClick={onDeleteClick}
                  disabled={isDeleting}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardFooter>
      </Card>

      {/* Print Order Sheet */}
      <PrintOrderSheet
        book={printOrderBook}
        isOpen={showPrintSheet}
        onClose={() => setShowPrintSheet(false)}
      />
    </>
  );
};

export default BookCard; 