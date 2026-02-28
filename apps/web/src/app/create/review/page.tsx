"use client";

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { BookStatus, Page, Book } from '@prisma/client';

// Import the new components
import PageTracker from '@/components/create/review/PageTracker';
import PageCard from '@/components/create/review/PageCard';
import NavigationControls from '@/components/create/review/NavigationControls';

// Define PageData with necessary fields from BookData context or fetched data
type PageData = {
  id: string | undefined; // Allow ID to be undefined initially
  text: string | null;
  originalImageUrl: string | null; // Original image URL from Page model
  assetId: string | null; // Original Asset ID from Page model
  pageNumber: number; // Added pageNumber field
  generatedImageUrl?: string | null; // Populated after illustration
  isTitlePage?: boolean; // Add a flag for easy identification
  moderationStatus?: string;
  moderationReason?: string | null;
};

type FullBookData = Book & { pages: Page[] }; // Type for the full fetched book

const POLLING_INTERVAL = 5000; // Check every 5 seconds

// Define the inner component containing the main logic
function ReviewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams(); // <-- Get search params
  // Keep context for now, but don't rely on it for bookId
  // const { bookData: contextBookData, setBookData } = useBookCreation(); // Unused 

  // Get bookId from URL query parameter
  const bookIdFromUrl = searchParams.get('bookId'); 

  // State hooks
  const [pages, setPages] = useState<PageData[]>([]); // Holds ALL pages (cover at index 0)
  const [isFetchingInitialData, setIsFetchingInitialData] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0); // Index in the FULL pages array
  const [confirmed, setConfirmed] = useState<boolean[]>([]);
  const [isLoadingText, setIsLoadingText] = useState(false);
  const [isSavingPage, setIsSavingPage] = useState(false);
  const [isStartingIllustration, setIsStartingIllustration] = useState(false);
  // Restore previous polling states
  const [needsTextPolling, setNeedsTextPolling] = useState(false);
  const textPollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Polling states for final illustration status
  const [isAwaitingFinalStatus, setIsAwaitingFinalStatus] = useState(false);
  const finalStatusPollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const isMountedRef = useRef(true);

  const [pendingTitleReview, setPendingTitleReview] = useState(''); // <-- State for pending title edits

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (textPollingIntervalRef.current) {
         clearInterval(textPollingIntervalRef.current);
      }
      if (finalStatusPollingIntervalRef.current) {
        clearInterval(finalStatusPollingIntervalRef.current);
      }
      // Ensure scroll is unlocked when component unmounts (navigation, etc.)
      document.body.style.removeProperty('overflow');
      document.documentElement.style.removeProperty('overflow');
    };
  }, []);

  // --- Initial Setup Logic --- 
  useEffect(() => {
    const fetchBookData = async () => {
      const bookIdToFetch = bookIdFromUrl;

      if (!bookIdToFetch) { // <-- Check bookId from URL
        toast.error("Book ID not found in URL. Cannot load review data.");
        setIsFetchingInitialData(false);
        return;
      }

      console.log(`Review Page: Fetching initial data for bookId: ${bookIdToFetch}`);
      setIsFetchingInitialData(true);
      try {
        const response = await fetch(`/api/book/${bookIdToFetch}`);
        if (!isMountedRef.current) return;

        if (!response.ok) {
          const errorText = await response.text().catch(() => `HTTP Error ${response.status}`);
          throw new Error(`Failed to fetch book data: ${errorText}`);
        }

        const fetchedBook: FullBookData = await response.json();
        if (!isMountedRef.current) return;

        if (!fetchedBook || !fetchedBook.pages) {
          throw new Error("Fetched data is invalid or missing pages.");
        }

        console.log("Review Page: Fetched Full Book Data:", fetchedBook);

        // Route guard: Redirect completed books to preview page
        if (fetchedBook.status === BookStatus.COMPLETED || fetchedBook.status === BookStatus.PARTIAL) {
          console.log(`[Review Page] Book ${bookIdToFetch} is already ${fetchedBook.status}, redirecting to preview`);
          router.replace(`/book/${bookIdToFetch}/preview`);
          return;
        }

        const sortedPages = [...fetchedBook.pages].sort((a, b) => a.index - b.index);

        if (sortedPages.length > 0) {
            const mappedPages: PageData[] = sortedPages.map((p: Page) => ({
              id: p.id,
              text: p.text,
              originalImageUrl: p.originalImageUrl, 
              assetId: p.assetId,
              generatedImageUrl: p.generatedImageUrl,
              isTitlePage: p.isTitlePage || (p.index === 0),
              pageNumber: p.pageNumber,
              moderationStatus: p.moderationStatus,
              moderationReason: p.moderationReason
            }));
            console.log("Review Page: Successfully mapped pages:", mappedPages); // Log after successful map
            setPages(mappedPages);
            // Store fetched book data (removed unused state variable)
            setPendingTitleReview(fetchedBook.title || ''); // <-- Initialize pending title
            
            // Initialize confirmed: ALL false initially
            setConfirmed(sortedPages.map(() => false)); 
            
            setCurrentIndex(0);

            const hasMissingText = mappedPages.some(p => !p.isTitlePage && p.text === null);

            if (hasMissingText && fetchedBook.status === BookStatus.GENERATING) {
              // This case should be less common now, but handle if pages exist but text is null
              console.log(`Review Page: Text missing and status is ${fetchedBook.status}. Starting text polling.`);
              setIsLoadingText(true);
              setNeedsTextPolling(true);
            } else if (fetchedBook.status === BookStatus.ILLUSTRATING) {
              console.log("Review Page: Status is ILLUSTRATING, setting up final status polling.");
              setIsLoadingText(false); 
              setNeedsTextPolling(false);
              setIsAwaitingFinalStatus(true); 
            } else {
              // Includes COMPLETED, FAILED, DRAFT (if pages somehow exist)
              console.log(`Review Page: Initial status ${fetchedBook.status}. No text polling needed.`);
              setIsLoadingText(false);
              setNeedsTextPolling(false);
              setIsAwaitingFinalStatus(false);
            }
        } else {
           // Status is not GENERATING, but no pages found - this is an error state.
           console.error(`Review Page: Status is ${fetchedBook.status}, but no pages found.`);
           throw new Error(`Book status is ${fetchedBook.status}, but no pages were loaded.`);
        }
      } catch (error) {
        console.error("Error fetching initial review data:", error);
        if (isMountedRef.current) {
          toast.error(`Error loading review data: ${error instanceof Error ? error.message : String(error)}`);
          // Optionally redirect or show a persistent error state
        }
      } finally {
        if (isMountedRef.current) {
          setIsFetchingInitialData(false);
        }
      }
    }

    fetchBookData();

  }, [bookIdFromUrl]); // <-- Depend on bookId from URL

  // --- Text Polling Function --- 
  const checkTextStatus = useCallback(async () => {
    const bookIdToPoll = bookIdFromUrl;
    if (!isMountedRef.current || !bookIdToPoll || !needsTextPolling) return;
    console.log("Polling for text generation status...");
    try {
      const statusRes = await fetch(`/api/book-status?bookId=${bookIdToPoll}`); 
      if (!isMountedRef.current) return;
      if (!statusRes.ok) {
        const errorText = await statusRes.text().catch(() => `HTTP error ${statusRes.status}`);
        throw new Error(`Failed to fetch book status: ${errorText}`);
      }
      const statusData = await statusRes.json();
      if (!isMountedRef.current) return;
      const newStatus = statusData.status as BookStatus;
      // Track status change (removed unused state variable)
      console.log("Poll Status (Text Check):", newStatus);
      if (newStatus === BookStatus.STORY_READY || newStatus === BookStatus.COMPLETED || newStatus === BookStatus.ILLUSTRATING) {
          if (isLoadingText) { 
              console.log("Text generation complete (status changed). Stopping poll and fetching full content...");
              if (textPollingIntervalRef.current) clearInterval(textPollingIntervalRef.current);
              setNeedsTextPolling(false);
              try {
                  const contentRes = await fetch(`/api/book/${bookIdToPoll}`); 
                  if (!isMountedRef.current) return;
                  if (!contentRes.ok) throw new Error(`Failed to fetch book content (${contentRes.status})`);
                  const fetchedBook = await contentRes.json();
                  if (!isMountedRef.current) return;
                  if (fetchedBook.pages) {
                      const updatedPageData: PageData[] = fetchedBook.pages.map((p: Page) => ({ 
                          id: p.id || undefined,
                          text: p.text || '',
                          originalImageUrl: p.originalImageUrl,
                          assetId: p.assetId,
                          pageNumber: p.pageNumber,
                          generatedImageUrl: p.generatedImageUrl || null,
                          isTitlePage: p.isTitlePage || false,
                          moderationStatus: p.moderationStatus,
                          moderationReason: p.moderationReason
                      }));
                      console.log("Review Page: Updating pages state with fetched text:", updatedPageData);
                      setPages(updatedPageData);
                      setConfirmed(fetchedBook.pages.map((p: Page) => p.textConfirmed || p.isTitlePage)); 
                      setIsLoadingText(false);
                      toast.success("Story text generated successfully!");
                  } else {
                      throw new Error("Fetched book content missing pages data.");
                  }
              } catch (contentError) {
                  console.error("Error fetching or processing book content:", contentError);
                  if (isMountedRef.current) {
                      setIsLoadingText(false);
                      toast.error(`Error loading book content: ${contentError instanceof Error ? contentError.message : String(contentError)}`);
                  }
              }
          } else {
              if (textPollingIntervalRef.current) clearInterval(textPollingIntervalRef.current);
              setNeedsTextPolling(false); 
              console.log("Book status changed to STORY_READY/COMPLETED/ILLUSTRATING, but wasn't loading text. Stopping poll.");
          }
      } else if (newStatus === BookStatus.FAILED) {
          if (textPollingIntervalRef.current) clearInterval(textPollingIntervalRef.current);
          setNeedsTextPolling(false);
          setIsLoadingText(false);
          console.error("Story generation failed.");
          toast.error("Story generation failed. Please check the book status or try again.");
      } else {
          console.log("Still generating text, continuing poll...");
      }
    } catch (error) {
      console.error("Text polling error:", error);
      if (textPollingIntervalRef.current) clearInterval(textPollingIntervalRef.current);
      if (isMountedRef.current) { 
          setNeedsTextPolling(false); 
          setIsLoadingText(false);
          toast.error(`Error checking text status: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }, [bookIdFromUrl, needsTextPolling, isLoadingText]); // <-- Update dependencies

  // --- Effect to Manage Text Polling Interval --- 
  useEffect(() => {
    const bookIdToPoll = bookIdFromUrl;
    if (isFetchingInitialData || !needsTextPolling || !bookIdToPoll) {
      if (textPollingIntervalRef.current) {
        clearInterval(textPollingIntervalRef.current);
        textPollingIntervalRef.current = null;
      }
      return;
    }

    if (!textPollingIntervalRef.current) {
      console.log(`Starting text polling interval for bookId: ${bookIdToPoll}`);
      checkTextStatus(); // Initial check immediately
      textPollingIntervalRef.current = setInterval(checkTextStatus, POLLING_INTERVAL);
    }

    // Cleanup
    return () => {
      if (textPollingIntervalRef.current) {
        clearInterval(textPollingIntervalRef.current);
        textPollingIntervalRef.current = null;
      }
    };
  }, [isFetchingInitialData, needsTextPolling, bookIdFromUrl, checkTextStatus]); // <-- Update dependencies

  // --- Final Status Polling Function --- 
  // This function has been removed as it was unused and causing TypeScript errors

  // --- Effect to Manage Final Status Polling Interval --- 
  useEffect(() => {
    const bookIdToPoll = bookIdFromUrl;
    if (isFetchingInitialData || !isAwaitingFinalStatus || !bookIdToPoll) {
      if (finalStatusPollingIntervalRef.current) {
        clearInterval(finalStatusPollingIntervalRef.current);
        finalStatusPollingIntervalRef.current = null;
      }
      return;
    }

    // Cleanup
    return () => {
      if (finalStatusPollingIntervalRef.current) {
        clearInterval(finalStatusPollingIntervalRef.current);
        finalStatusPollingIntervalRef.current = null;
      }
    };
  }, [isFetchingInitialData, isAwaitingFinalStatus, bookIdFromUrl]); // Removed checkFinalBookStatus from dependencies

  // Navigation handlers (operate on full pages array index)
  const goPrev = () => setCurrentIndex(i => Math.max(i - 1, 0));
  const goNext = () => setCurrentIndex(i => Math.min(i + 1, pages.length - 1));

  // Handle text updates
  const handleTextChange = (newText: string) => {
    if (currentIndex === 0) {
      // Handle title page text change
      setPendingTitleReview(newText);
    } else {
      // Handle regular page text change
      setPages(prev => {
        const copy = [...prev];
        if (copy[currentIndex]) {
          copy[currentIndex] = { ...copy[currentIndex], text: newText };
        }
        return copy;
      });
    }
    
    // Mark as unconfirmed when text changes
    setConfirmed(prev => {
      const copy = [...prev];
      copy[currentIndex] = false;
      return copy;
    });
  };

  // Toggle confirmation per page / title
  const toggleConfirm = async () => {
    const currentPage = pages[currentIndex];
    const bookIdToUse = bookIdFromUrl;

    // No bookId or trying to confirm non-existent page index
    if (!bookIdToUse || !currentPage) { 
        toast.error("Cannot confirm: Missing book or page data.");
        return; 
    }
    
    // Skip if already confirmed
    if (confirmed[currentIndex]) {
      return;
    }
    
    // --- Save and Confirm --- 
    setIsSavingPage(true);
    try {
      let response: Response;
      if (currentIndex === 0) { // Saving Title Page
        if (!pendingTitleReview.trim()) throw new Error("Book title cannot be empty.");
        response = await fetch(`/api/book/${bookIdToUse}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: pendingTitleReview }), // Send updated title
        });
      } else { // Saving Story Page
        if (!currentPage.id) throw new Error("Page ID is missing, cannot save.");
        response = await fetch(`/api/book/${bookIdToUse}/page/${currentPage.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: currentPage.text || '', textConfirmed: true }), 
        });
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to save (Status: ${response.status})`);
      }
      
      // Update main state *after* successful save
      if (currentIndex === 0) {
          // Update book details (removed unused state variable)
      }
      
      // Mark as confirmed locally
      setConfirmed(arr => {
        const copy = [...arr];
        copy[currentIndex] = true; 
        return copy;
      });
      // Removed toast notification when page is confirmed
      // toast.success(currentIndex === 0 ? "Title page saved and confirmed!" : `Page ${currentIndex} saved and confirmed!`);

      // Auto-advance to next page after confirmation if not on last page
      if (currentIndex < pages.length - 1) {
        goNext();
      }

    } catch (error) {
      console.error("Error saving page/title:", error);
      toast.error(`${error instanceof Error ? error.message : String(error)}`);
    } finally {
       if (isMountedRef.current) { 
           setIsSavingPage(false);
       }
    }
  };
  
  // Regenerate Story handler
  // This function has been removed as it was unused and causing TypeScript errors

  // --- Illustrate Book Handler ---
  const handleIllustrate = async () => {
    const bookIdToUse = bookIdFromUrl;
    if (!bookIdToUse || !allConfirmed || isLoadingText) {
       toast.warning("Cannot start illustration. Ensure all pages are confirmed and story text is loaded.");
       return;
     }
     if (isStartingIllustration || isAwaitingFinalStatus) return;

     console.log("Attempting to start illustration process...");
     setIsStartingIllustration(true);

     try {
        const response = await fetch('/api/generate/illustrations', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookId: bookIdToUse }),
        });
        if (!response.ok && response.status !== 202) {
            const errorData = await response.json().catch(() => ({ message: "Unknown error occurred" }));
            throw new Error(errorData.error || errorData.message || `Failed to start illustration generation (Status: ${response.status})`);
        }
        const result = await response.json().catch(() => ({}));
        console.log("Illustration Job Request Result:", result);

        // Redirect to library immediately
        router.push('/library');

     } catch (error) {
        console.error("Error initiating illustration generation:", error);
        if (isMountedRef.current) {
           toast.error(`Error starting illustration: ${error instanceof Error ? error.message : String(error)}`);
           setIsStartingIllustration(false);
        }
     }
  };

  // Keyboard arrow navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', handleKey);
    // Need dependencies here for goPrev/goNext if they aren't stable
    return () => window.removeEventListener('keydown', handleKey);
  }, [/* Add goPrev, goNext if needed */]); 

  const allConfirmed = pages.length > 0 && confirmed.every(c => c);
  const confirmedCount = confirmed.filter(Boolean).length;
  const isWorking = isLoadingText || isSavingPage || isStartingIllustration || isAwaitingFinalStatus || isFetchingInitialData;

  // Handle loading/redirect state before rendering main UI
  if (isFetchingInitialData) {
      return <div className="p-6 flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin mr-2" /> Loading review data...</div>;
  }

  if (pages.length === 0 && !isFetchingInitialData) {
      return <div className="p-6 text-red-600">Error: Could not load pages for review. Please go back and try again.</div>;
  }

  const currentPageData = pages[currentIndex];
  const isTitlePageSelected = currentIndex === 0 && pages.length > 0; // Simpler check

  // Main Render - New Mobile-Optimized Layout
  return (
    <div className="flex flex-col h-screen">
      {/* Progress Tracker at Top */}
      <PageTracker 
        totalPages={pages.length} 
        currentPage={currentIndex} 
        confirmedPages={confirmedCount} 
        onPageSelect={setCurrentIndex} 
        allPagesConfirmed={allConfirmed}
        isProcessing={isWorking && !isAwaitingFinalStatus} // Modify isProcessing if needed
        onIllustrate={handleIllustrate}
      />
      
      {/* Main Content Area - Shows One Page at a Time */}
      <div className="flex-1 overflow-y-auto p-4">
        <PageCard 
          id={currentPageData?.id}
          imageUrl={currentPageData?.generatedImageUrl || currentPageData?.originalImageUrl}
          text={isTitlePageSelected ? pendingTitleReview : currentPageData?.text}
          pageNumber={isTitlePageSelected ? 0 : currentIndex}
          isTitlePage={isTitlePageSelected}
          isConfirmed={confirmed[currentIndex]}
          moderationStatus={currentPageData?.moderationStatus}
          moderationReason={currentPageData?.moderationReason}
          isSaving={isSavingPage}
          bookId={bookIdFromUrl || ''}
          onTextChange={handleTextChange}
          onConfirm={toggleConfirm}
        />
      </div>
      
      {/* Bottom Navigation */}
      <NavigationControls 
        currentPage={currentIndex}
        totalPages={pages.length}
        canGoNext={currentIndex < pages.length - 1 && !isWorking}
        canGoPrevious={currentIndex > 0 && !isWorking}
        isProcessing={isWorking}
        onPrevious={goPrev}
        onNext={goNext}
      />
    </div>
  );
}

// Default export wraps the content component with Suspense
export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="p-6 flex justify-center items-center h-screen"><Loader2 className="h-8 w-8 animate-spin mr-2" /> Loading review page...</div>}>
      <ReviewPageContent />
    </Suspense>
  );
}
