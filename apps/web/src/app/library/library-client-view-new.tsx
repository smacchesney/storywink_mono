"use client";

import React, { useState, useMemo, useTransition, useEffect } from 'react';
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
import { toast } from 'sonner';
import { showError, showErrorWithRetry, showSuccess } from '@/lib/toast-utils';
import { useRouter } from 'next/navigation';
import { PlusCircle, Filter, SortDesc } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from '@/components/ui/skeleton';

// Define types locally
type BookStatus = "draft" | "generating" | "completed" | "illustrating" | "failed" | "partial";

type LibraryBook = {
  id: string;
  title: string;
  status: BookStatus;
  createdAt: string;
  childName: string;
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
  const [activeTab, setActiveTab] = useState<string>("in-progress");
  const router = useRouter();

  // Fetch books from API
  useEffect(() => {
    async function fetchBooks() {
      if (!isLoaded) return;
      
      try {
        const token = await getToken();
        if (!token) {
          router.push('/sign-in');
          return;
        }

        const response = await apiClient.getBooks(token);
        if (response.success && response.data) {
          setBooks(response.data as LibraryBook[]);
        } else {
          showError(response.error || 'Failed to load books', 'Unable to load your library');
        }
      } catch (error) {
        console.error('Error fetching books:', error);
        showErrorWithRetry(error, 'Unable to load your library', () => window.location.reload());
      } finally {
        setIsLoading(false);
      }
    }

    fetchBooks();
  }, [isLoaded, getToken, router]);

  // Sort books
  const sortedBooks = useMemo(() => {
    return [...books].sort((a, b) => {
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      }
      // Sort by updatedAt (most recent first)
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [books, sortBy]);

  const inProgressBooks = sortedBooks.filter(book => book.status !== 'COMPLETED');
  const completedBooks = sortedBooks.filter(book => book.status === 'COMPLETED');

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
            <Button size="sm" className="w-full sm:w-auto">
              <PlusCircle className="h-4 w-4 mr-2" />
              Create New Book
            </Button>
          </Link>
        </div>
      </div>

      {/* Mobile Tabs */}
      <div className="block md:hidden mb-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="in-progress">
              In Progress ({inProgressBooks.length})
            </TabsTrigger>
            <TabsTrigger value="completed">
              Completed ({completedBooks.length})
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="in-progress">
            <BookGrid books={inProgressBooks} onDelete={openDeleteDialog} getCoverImageUrl={getCoverImageUrl} />
          </TabsContent>
          
          <TabsContent value="completed">
            <BookGrid books={completedBooks} onDelete={openDeleteDialog} getCoverImageUrl={getCoverImageUrl} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Desktop Layout */}
      <div className="hidden md:block space-y-8">
        {/* In Progress Books */}
        <BookSection 
          title="In Progress" 
          books={inProgressBooks} 
          onDelete={openDeleteDialog}
          getCoverImageUrl={getCoverImageUrl}
        />
        
        {/* Completed Books */}
        <BookSection 
          title="Completed" 
          books={completedBooks} 
          onDelete={openDeleteDialog}
          getCoverImageUrl={getCoverImageUrl}
        />
      </div>

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
function BookSection({ 
  title, 
  books, 
  onDelete, 
  getCoverImageUrl 
}: { 
  title: string; 
  books: LibraryBook[]; 
  onDelete: (book: LibraryBook) => void;
  getCoverImageUrl: (book: LibraryBook) => string | null;
}) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-4">
        {title} ({books.length})
      </h2>
      <BookGrid books={books} onDelete={onDelete} getCoverImageUrl={getCoverImageUrl} />
    </section>
  );
}

function BookGrid({ 
  books, 
  onDelete, 
  getCoverImageUrl 
}: { 
  books: LibraryBook[]; 
  onDelete: (book: LibraryBook) => void;
  getCoverImageUrl: (book: LibraryBook) => string | null;
}) {
  if (books.length === 0) {
    return (
      <Card className="p-8 text-center">
        <CardContent>
          <p className="text-slate-500 dark:text-slate-400">No books found.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {books.map((book) => (
        <BookCard
          key={book.id}
          book={{
            ...book,
            coverImageUrl: getCoverImageUrl(book),
            createdAt: new Date(book.createdAt),
            updatedAt: new Date(book.updatedAt),
          }}
          onDelete={() => onDelete(book)}
        />
      ))}
    </div>
  );
}