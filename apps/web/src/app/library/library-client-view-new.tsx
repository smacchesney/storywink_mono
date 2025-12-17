"use client";

import React, { useState, useMemo, useTransition, useEffect, useCallback, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import BookCard from "@/components/book-card";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@clerk/nextjs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { showError, showErrorWithRetry, showSuccess } from '@/lib/toast-utils';
import { useRouter } from 'next/navigation';
import { SortDesc } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

// Polling interval for checking illustration status (5 seconds)
const POLLING_INTERVAL = 5000;

// Define BookStatus inline (can't import from Prisma in client components)
type BookStatus = "DRAFT" | "GENERATING" | "STORY_READY" | "ILLUSTRATING" | "COMPLETED" | "FAILED" | "PARTIAL";

// Statuses that should be visible in the library
const VISIBLE_STATUSES: BookStatus[] = ['ILLUSTRATING', 'COMPLETED', 'PARTIAL', 'FAILED'];

type LibraryBook = {
  id: string;
  title: string;
  status: BookStatus;
  createdAt: string;
  updatedAt: string;
  pages: Array<{
    id: string;
    originalImageUrl?: string | null;
    generatedImageUrl?: string | null;
  }>;
};

type SortOption = 'updatedAt' | 'title';

export function LibraryClientView() {
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
  const fetchBooks = useCallback(async (showLoadingState = true) => {
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
        showError(response.error || 'Failed to load books', 'Unable to load your library');
      }
    } catch (error) {
      console.error('Error fetching books:', error);
      if (showLoadingState) {
        showErrorWithRetry(error, 'Unable to load your library', () => window.location.reload());
      }
    } finally {
      if (showLoadingState) {
        setIsLoading(false);
      }
    }
  }, [isLoaded, getToken, router]);

  // Initial fetch
  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  // Filter to only show visible statuses and sort
  const visibleBooks = useMemo(() => {
    return books.filter(book => VISIBLE_STATUSES.includes(book.status));
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

  // Check if any books are currently illustrating
  const hasIllustratingBooks = useMemo(() => {
    return books.some(book => book.status === 'ILLUSTRATING');
  }, [books]);

  // Poll for updates when there are illustrating books
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
          setBooks(books.filter(book => book.id !== bookToDelete.id));
          showSuccess('Book deleted successfully');
          setIsDeleteDialogOpen(false);
          setBookToDelete(null);
        } else {
          showError(response.error || 'Failed to delete book', 'Unable to delete book');
        }
      } catch (error) {
        console.error('Error deleting book:', error);
        showErrorWithRetry(error, 'Unable to delete book', handleDeleteBook);
      }
    });
  };

  const getCoverImageUrl = (book: LibraryBook): string | null => {
    // Find the first page with an image
    const pageWithImage = book.pages.find(page =>
      page.generatedImageUrl || page.originalImageUrl
    );
    return pageWithImage?.generatedImageUrl || pageWithImage?.originalImageUrl || null;
  };

  // Handle retry for failed/partial books
  const handleRetryIllustrations = async (bookId: string) => {
    setIsRetrying(bookId);
    try {
      const token = await getToken();
      if (!token) return;

      const response = await fetch('/api/generate/illustrations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ bookId }),
      });

      if (response.ok) {
        showSuccess('Retrying illustrations...');
        // Refresh books to get updated status
        await fetchBooks(false);
      } else {
        const errorData = await response.json();
        showError(errorData.error || 'Failed to retry illustrations', 'Retry failed');
      }
    } catch (error) {
      console.error('Error retrying illustrations:', error);
      showError('Failed to retry illustrations', 'Retry failed');
    } finally {
      setIsRetrying(null);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-6">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Your Library</h1>
        
        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
          {/* Sort selector */}
          <Select value={sortBy} onValueChange={(value: SortOption) => setSortBy(value)}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SortDesc className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updatedAt">Recent</SelectItem>
              <SelectItem value="title">Title</SelectItem>
            </SelectContent>
          </Select>

          {/* Create new book button */}
          <Link href="/create">
            <Button size="sm" className="w-full sm:w-auto bg-[#F76C5E] hover:bg-[#E55A4C] text-white rounded-full font-playful group">
              <svg
                className="mr-2 h-4 w-4 transition-transform group-hover:scale-125 group-hover:rotate-12"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 0L14.59 8.41L23 11L14.59 13.59L12 22L9.41 13.59L1 11L9.41 8.41L12 0Z" />
              </svg>
              Create New Book
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
            <AlertDialogTitle>Delete Book</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{bookToDelete?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteBook}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
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
  if (books.length === 0) {
    return (
      <Card className="p-8 text-center">
        <CardContent>
          <p className="text-slate-500 dark:text-slate-400">No books yet. Create your first storybook!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {books.map((book) => (
        <BookCard
          key={book.id}
          id={book.id}
          title={book.title}
          status={book.status}
          updatedAt={new Date(book.updatedAt)}
          pages={undefined}
          coverImageUrl={getCoverImageUrl(book)}
          onDeleteClick={() => onDelete(book)}
          onRetryClick={() => onRetry(book.id)}
          isRetrying={isRetrying === book.id}
        />
      ))}
    </div>
  );
}