'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { CharacterSelectionScreen } from '@/components/create/characters/CharacterSelectionScreen';
import logger from '@/lib/logger';

interface Page {
  id: string;
  assetId: string | null;
  asset: {
    id: string;
    url: string;
    thumbnailUrl: string | null;
  } | null;
}

interface BookData {
  id: string;
  pages: Page[];
}

export default function CharactersPage() {
  const params = useParams<{ bookId: string }>();
  const router = useRouter();
  const { getToken, isLoaded } = useAuth();
  const [book, setBook] = useState<BookData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bookId = params.bookId;

  useEffect(() => {
    if (!isLoaded || !bookId) return;

    const fetchBook = async () => {
      try {
        const token = await getToken();
        if (!token) {
          throw new Error('Not authenticated');
        }

        const response = await fetch(`/api/book/${bookId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Book not found');
          }
          throw new Error('Failed to fetch book');
        }

        const data = await response.json();
        // API returns book directly (not wrapped in { book })
        setBook(data);
      } catch (err) {
        logger.error({ error: err }, 'Failed to fetch book');
        setError(err instanceof Error ? err.message : 'An error occurred');
        toast.error('Failed to load book');
      } finally {
        setIsLoading(false);
      }
    };

    fetchBook();
  }, [bookId, getToken, isLoaded]);

  // Loading state
  if (isLoading || !isLoaded) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)]">
        <Loader2 className="w-10 h-10 text-[#F76C5E] animate-spin" />
        <p className="mt-4 text-gray-600">Loading book...</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] px-4">
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">
            Something went wrong
          </h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={() => router.push('/create')}
            className="text-[#F76C5E] hover:underline"
          >
            Go back to Create
          </button>
        </div>
      </div>
    );
  }

  // No book found
  if (!book) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] px-4">
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">
            Book not found
          </h2>
          <button
            onClick={() => router.push('/create')}
            className="text-[#F76C5E] hover:underline"
          >
            Go back to Create
          </button>
        </div>
      </div>
    );
  }

  // Extract photos from book pages
  const photos = book.pages
    .filter((page) => page.asset?.url)
    .map((page) => ({
      assetId: page.asset!.id,
      url: page.asset!.url,
    }));

  // If no photos, skip to edit
  if (photos.length === 0) {
    router.push(`/create/${bookId}/edit`);
    return null;
  }

  return <CharacterSelectionScreen bookId={bookId} photos={photos} />;
}
