'use client';

import React, { useState, useMemo, useTransition, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import Image from 'next/image';
import BookCard from '@/components/book-card';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@clerk/nextjs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { showError, showErrorWithRetry } from '@/lib/toast-utils';
import { resolveCoverImageUrl } from '@/lib/book-display';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SortDesc } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ScallopEdge } from '@/components/ui/scallop-edge';
import { STAR5 } from '@/components/ui/storydust';

// One grid, everywhere: single column on portrait phones, two on landscape
// phones and short windows (`short:`), three/four only where there's height
// for footers (`tall:` gates md/lg so the variants never fight `sm:`).
const LIBRARY_GRID_CLASSES =
  'grid grid-cols-1 sm:grid-cols-2 short:grid-cols-2 tall:md:grid-cols-3 tall:lg:grid-cols-4 gap-4 sm:gap-6';

// Polling interval for checking illustration status (5 seconds)
const POLLING_INTERVAL = 5000;

// Define BookStatus inline (can't import from Prisma in client components)
type BookStatus =
  'DRAFT' | 'GENERATING' | 'STORY_READY' | 'ILLUSTRATING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';

// Every book the parent owns belongs on the shelf — an abandoned draft or a
// book mid-generation is otherwise unreachable (no resume, no delete).
const VISIBLE_STATUSES: BookStatus[] = [
  'DRAFT',
  'GENERATING',
  'STORY_READY',
  'ILLUSTRATING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
];

type LibraryBook = {
  id: string;
  title: string;
  status: BookStatus;
  qcRound?: number;
  coverImageUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  pages: Array<{
    id: string;
    originalImageUrl?: string | null;
    generatedImageUrl?: string | null;
    isTitlePage?: boolean;
  }>;
};

type SortOption = 'updatedAt' | 'title';

export function LibraryClientView() {
  const t = useTranslations('library');
  const tc = useTranslations('common');
  const tIssue = useTranslations('issue');
  const { getToken, isLoaded } = useAuth();
  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>('updatedAt');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [bookToDelete, setBookToDelete] = useState<LibraryBook | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isRetrying, setIsRetrying] = useState<string | null>(null); // Track which book is being retried
  const router = useRouter();
  const tokenRef = useRef<string | null>(null);

  // Fetch books from API
  const fetchBooks = useCallback(
    async (showLoadingState = true) => {
      if (!isLoaded) return;

      try {
        const token = await getToken();
        if (!token) {
          router.push('/sign-in');
          return;
        }

        // Store token for polling
        tokenRef.current = token;

        const response = await apiClient.getBooks(token);
        if (response.success && response.data) {
          setBooks(response.data as LibraryBook[]);
        } else if (showLoadingState) {
          showError(response.error || 'Failed to load books', t('unableToLoad'));
        }
      } catch (error) {
        console.error('Error fetching books:', error);
        if (showLoadingState) {
          showErrorWithRetry(error, t('unableToLoad'), () => window.location.reload(), tc('retry'));
        }
      } finally {
        if (showLoadingState) {
          setIsLoading(false);
        }
      }
    },
    [isLoaded, getToken, router],
  );

  // Initial fetch
  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  // Filter to only show visible statuses and sort
  const visibleBooks = useMemo(() => {
    return books.filter((book) => VISIBLE_STATUSES.includes(book.status));
  }, [books]);

  const sortedBooks = useMemo(() => {
    return [...visibleBooks].sort((a, b) => {
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      }
      // Sort by updatedAt (most recent first)
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [visibleBooks, sortBy]);

  // Keep polling through every non-terminal state — a story-stage retry
  // moves a book to GENERATING, and stopping the poll there would leave the
  // card looking stuck until a manual refresh.
  const hasIllustratingBooks = useMemo(() => {
    return books.some(
      (book) =>
        book.status === 'ILLUSTRATING' ||
        book.status === 'GENERATING' ||
        book.status === 'STORY_READY',
    );
  }, [books]);

  // Poll for updates while any book is being worked on
  useEffect(() => {
    if (!hasIllustratingBooks || !isLoaded) return;

    const intervalId = setInterval(() => {
      fetchBooks(false); // Silent fetch (no loading state)
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [hasIllustratingBooks, isLoaded, fetchBooks]);

  const openDeleteDialog = (book: LibraryBook) => {
    setBookToDelete(book);
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteBook = async () => {
    if (!bookToDelete) return;

    startDeleteTransition(async () => {
      try {
        const token = await getToken();
        if (!token) return;

        const response = await apiClient.deleteBook(bookToDelete.id, token);
        if (response.success) {
          setBooks(books.filter((book) => book.id !== bookToDelete.id));
          setIsDeleteDialogOpen(false);
          setBookToDelete(null);
        } else if (response.code === 'PRINT_ORDER_IN_FLIGHT') {
          // Coded error → localized copy (en/ja); the raw server string stays
          // the fallback for any error without a known code.
          showError(t('printOrderInFlight'), t('unableToDelete'));
          setIsDeleteDialogOpen(false);
          setBookToDelete(null);
        } else {
          showError(response.error || 'Failed to delete book', t('unableToDelete'));
        }
      } catch (error) {
        console.error('Error deleting book:', error);
        showErrorWithRetry(error, t('unableToDelete'), handleDeleteBook, tc('retry'));
      }
    });
  };

  // Dedicated painted cover first, then the title page's illustration, then
  // any illustration, then the original photos.
  const getCoverImageUrl = (book: LibraryBook): string | null => resolveCoverImageUrl(book);

  // Handle retry for failed books. The status-aware /retry endpoint decides
  // whether to re-run story generation or re-enter illustration itself.
  const handleRetryIllustrations = async (bookId: string) => {
    setIsRetrying(bookId);
    try {
      const response = await fetch(`/api/book/${bookId}/retry`, {
        method: 'POST',
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 202) {
        // Retry accepted — refresh so the card picks up the working status.
        await fetchBooks(false);
      } else if (response.ok && data.flaggedCount > 0) {
        // Only content-flagged pages remain — those need the resolve flow.
        router.push(`/book/${bookId}/resolve`);
      } else if (response.ok) {
        await fetchBooks(false);
      } else {
        showError(data.error || 'retry rejected', tIssue('retryFailed'));
      }
    } catch (error) {
      console.error('Error retrying book:', error);
      showError(error, tIssue('retryFailed'));
    } finally {
      setIsRetrying(null);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className={LIBRARY_GRID_CLASSES}>
          {/* Cream book-shaped placeholders — same proportions as a loaded
              card (square cover + title row), a cloud edge on top, one still
              star waiting for the books to arrive. */}
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex flex-col rounded-xl border bg-cream p-3 shadow-sm">
              <Skeleton className="relative aspect-square w-full overflow-hidden rounded-md bg-cream-deep">
                <ScallopEdge className="absolute inset-x-0 top-0 opacity-40" />
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  className="absolute top-1/2 left-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-coral opacity-15"
                >
                  <path d={STAR5} />
                </svg>
              </Skeleton>
              <Skeleton className="mt-3 h-5 w-3/4 bg-cream-deep" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Image
            src="https://res.cloudinary.com/storywink/image/upload/v1772291377/Screenshot_2026-02-28_at_10.58.09_PM_gnknk5.png"
            alt={t('mascotAlt')}
            width={60}
            height={60}
            className="h-12 w-12 md:h-15 md:w-15"
          />
          <h1 className="font-playful text-2xl font-bold text-ink">{t('yourLibrary')}</h1>
        </div>

        <div className="flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
          {/* Sort selector */}
          <Select value={sortBy} onValueChange={(value: SortOption) => setSortBy(value)}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SortDesc className="mr-2 h-4 w-4" />
              <SelectValue placeholder={t('sortBy')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updatedAt">{t('sortRecent')}</SelectItem>
              <SelectItem value="title">{t('sortTitle')}</SelectItem>
            </SelectContent>
          </Select>

          {/* My characters (X6, flag-gated) */}
          {process.env.NEXT_PUBLIC_AVATARS_ENABLED === 'true' && (
            <Link
              href="/characters"
              className="flex min-h-[36px] items-center rounded-full border border-black/10 px-3 font-playful text-sm text-gray-600 hover:border-coral/50 hover:text-gray-800"
            >
              {t('charactersTab')}
            </Link>
          )}
          {/* Create new book button */}
          <Link href="/create">
            <Button
              size="sm"
              className="group w-full rounded-full bg-coral font-playful text-white hover:bg-[#E55A4C] sm:w-auto"
            >
              <svg
                className="mr-2 h-4 w-4 transition-transform group-hover:scale-125 group-hover:rotate-12"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 0L14.59 8.41L23 11L14.59 13.59L12 22L9.41 13.59L1 11L9.41 8.41L12 0Z" />
              </svg>
              {t('createNewBook')}
            </Button>
          </Link>
        </div>
      </div>

      {/* Single unified book grid */}
      <BookGrid
        books={sortedBooks}
        onDelete={openDeleteDialog}
        getCoverImageUrl={getCoverImageUrl}
        onRetry={handleRetryIllustrations}
        isRetrying={isRetrying}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteBook')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirmation', { title: bookToDelete?.title || '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteBook}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? tc('deleting') : tc('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Helper Components
function BookGrid({
  books,
  onDelete,
  getCoverImageUrl,
  onRetry,
  isRetrying,
}: {
  books: LibraryBook[];
  onDelete: (book: LibraryBook) => void;
  getCoverImageUrl: (book: LibraryBook) => string | null;
  onRetry: (bookId: string) => void;
  isRetrying: string | null;
}) {
  const t = useTranslations('library');

  if (books.length === 0) {
    // An invitation, not a dead end: the cats, one line, one coral CTA.
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Image
          src="https://res.cloudinary.com/storywink/image/upload/v1772291378/Screenshot_2026-02-28_at_10.57.29_PM_qwoqr0.png"
          alt={t('mascotAlt')}
          width={160}
          height={160}
          className="h-28 w-auto"
        />
        <p className="mt-5 font-playful text-lg text-[#1a1a1a] dark:text-white">
          {t('emptyTitle')}
        </p>
        <Button
          asChild
          className="mt-6 rounded-full bg-coral px-6 font-playful text-white hover:bg-[#E55A4C]"
        >
          <Link href="/create">{t('emptyCta')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className={LIBRARY_GRID_CLASSES}>
      {books.map((book) => (
        <BookCard
          key={book.id}
          id={book.id}
          title={book.title}
          status={book.status}
          qcRound={book.qcRound}
          updatedAt={new Date(book.updatedAt)}
          pageCount={book.pages?.length ?? 0}
          coverImageUrl={getCoverImageUrl(book)}
          onDeleteClick={() => onDelete(book)}
          onRetryClick={() => onRetry(book.id)}
          isRetrying={isRetrying === book.id}
        />
      ))}
    </div>
  );
}
