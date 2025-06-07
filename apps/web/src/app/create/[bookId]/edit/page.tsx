"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, HelpCircle } from 'lucide-react';
import { StoryboardPage, BookWithStoryboardPages } from '@/shared/types'; // <-- Import shared types
import BottomToolbar, { EditorTab } from '@/components/create/editor/BottomToolbar'; // <-- Import Toolbar
import PhotoSourceSheet from '@/components/create/PhotoSourceSheet'; // <-- Import Sheet for Add Photo
import { CloudinaryUploaderAuto } from '@/components/cloudinary-uploader-auto'; // <-- Import auto Cloudinary uploader
import logger from '@/lib/logger';
import Canvas from '@/components/create/editor/Canvas'; // <-- Import Canvas
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import StoryboardGrid from '@/components/create/editor/StoryboardGrid';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import ArtStylePicker from '@/components/create/editor/ArtStylePicker';
import CoverEditorPanel from '@/components/create/editor/CoverEditorPanel';
import DetailsEditorPanel from '@/components/create/editor/DetailsEditorPanel'; // <-- Import new component
import { Asset } from '@prisma/client'; // Import Asset for filtering
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'; // Import Tooltip
import WritingProgressScreen from '@/components/create/editor/WritingProgressScreen'; // Import Progress Screen
import AdditionalPhotoUploadProgressScreen from '@/components/create/editor/AdditionalPhotoUploadProgressScreen'; // <-- Import new progress screen
import useMediaQuery from '@/hooks/useMediaQuery'; // Import the hook
import Joyride, { Step, EVENTS, STATUS, CallBackProps } from 'react-joyride'; // <-- Add Joyride imports
import { cn } from '@/lib/utils';
import { useAuth } from '@clerk/nextjs';

export default function EditBookPage() {
  const params = useParams();
  const router = useRouter();
  const { getToken } = useAuth();
  const bookId = params.bookId as string; // Get bookId from dynamic route
  const isDesktop = useMediaQuery('(min-width: 768px)'); // Tailwind md breakpoint

  const [bookData, setBookData] = useState<BookWithStoryboardPages | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>('details'); // Default to details
  const [isPhotoSheetOpen, setIsPhotoSheetOpen] = useState(false); // <-- State for Add Photo sheet
  const [showCloudinaryUploader, setShowCloudinaryUploader] = useState(false); // <-- State for Cloudinary uploader
  const fileInputRef = useRef<HTMLInputElement>(null); // <-- Keep for backwards compatibility
  const [isPagesPanelOpen, setIsPagesPanelOpen] = useState(false); // Unified state for Sheet/Drawer
  const [storyboardOrder, setStoryboardOrder] = useState<StoryboardPage[]>([]); // Use StoryboardPage type
  const [isSavingOrder, setIsSavingOrder] = useState(false); // <-- Add loading state for saving
  const [isArtStylePanelOpen, setIsArtStylePanelOpen] = useState(false); // <-- State for Art Style panel
  // State for pending Art Style changes
  const [pendingArtStyle, setPendingArtStyle] = useState<string | null | undefined>(undefined);
  const [pendingWinkifyEnabled, setPendingWinkifyEnabled] = useState<boolean>(false);
  const [isSavingArtStyle, setIsSavingArtStyle] = useState(false); // <-- Loading state for saving style
  const [isCoverPanelOpen, setIsCoverPanelOpen] = useState(false); // <-- State for Cover panel
  // State for pending Cover changes
  const [pendingTitle, setPendingTitle] = useState('');
  const [pendingChildName, setPendingChildName] = useState('');
  const [pendingCoverAssetId, setPendingCoverAssetId] = useState<string | null | undefined>(undefined);
  const [isSavingCover, setIsSavingCover] = useState(false); // <-- Loading state for saving cover
  const [isGeneratingStory, setIsGeneratingStory] = useState(false); // <-- State for generation loading
  const [showGenerationProgress, setShowGenerationProgress] = useState(false); // <-- Add state for progress screen visibility
  // Add saved state trackers
  const [showPhotoUploadProgress, setShowPhotoUploadProgress] = useState(false); // <-- New state for photo upload progress screen

  // States for the new Details Panel
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false); // Changed to false
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  // --- Step Completion Tracking ---
  const [completedSteps, setCompletedSteps] = useState<Set<EditorTab>>(new Set());
  const [pagesResetKey, setPagesResetKey] = useState(0); // Key to track when pages are added/changed
  const [pagesConfirmed, setPagesConfirmed] = useState(false); // Track if user has confirmed page order

  // --- React Joyride State ---
  const [runTour, setRunTour] = useState(false); // <-- Initialize to false, tour won't start automatically
  const [tourSteps, setTourSteps] = useState<Step[]>([]);
  // ---------------------------

  const isMountedRef = useRef(true);

  // --- Fetch Book Data (Defined earlier with useCallback) ---
  const fetchBookData = useCallback(async () => {
    if (!bookId) {
      toast.error("Book ID is missing.");
      setError("Book ID is missing from the URL.");
      setIsLoading(false);
      return;
    }
    console.log(`Fetching/Refetching book data for ${bookId}`);
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/book/${bookId}`);
      if (!isMountedRef.current) return; // Check mount status
      if (!response.ok) {
        let errorMsg = `Failed to fetch book data: ${response.statusText}`;
        try {
           const errData = await response.json();
           errorMsg = errData.error || errorMsg;
        } catch {}
        throw new Error(errorMsg);
      }
      const data: BookWithStoryboardPages = await response.json();
      if (!isMountedRef.current) return; 
      setBookData(data);
    } catch (err) {
      console.error("Error fetching book:", err);
      const message = err instanceof Error ? err.message : "An unknown error occurred";
      toast.error(`Error loading book: ${message}`);
      setError(message);
      // Optionally redirect if book not found (e.g., status 404)
      // if (err instanceof Error && err.message.includes('404')) { 
      //   router.push('/create'); // Or a dedicated not-found page
      // }
    } finally {
      if (isMountedRef.current) { setIsLoading(false); }
    }
  }, [bookId, router]);

  // Initial fetch
  useEffect(() => {
    fetchBookData();
  }, [fetchBookData]);
  
  // Mount/unmount ref effect
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Update storyboardOrder state when the underlying bookData changes OR cover changes
  useEffect(() => {
    if (bookData?.pages) {
        const filteredPages = bookData.pages
            .filter(page => page.assetId !== bookData.coverAssetId)
            // Sort stably first (e.g., by original pageNumber or createdAt if index isn't reliable yet)
            .sort((a, b) => a.pageNumber - b.pageNumber); // Or sort by a.createdAt.getTime() - b.createdAt.getTime()
            
        // Re-assign sequential indices FOR DISPLAY in the storyboard context
        const reIndexedFilteredPages = filteredPages.map((page, idx) => ({
            ...page,
            // NOTE: We are modifying the index/pageNumber in the local state copy 
            // for immediate visual consistency in the grid. 
            // The final correct indices are assigned during save.
            index: idx,       // Temporary visual index (0-based)
            pageNumber: idx + 1 // Temporary visual page number (1-based)
        }));

        setStoryboardOrder(reIndexedFilteredPages);
    }
  }, [bookData?.pages, bookData?.coverAssetId]);

  // Add useEffect to close panels if screen size changes to mobile
  useEffect(() => {
    if (!isDesktop) {
      // Close all panels if we switch to a mobile view and a panel is open
      setIsCoverPanelOpen(false);
      setIsPagesPanelOpen(false);
      setIsArtStylePanelOpen(false);
      // Ensure tour also closes or adapts if needed for mobile view changes during tour
      // For now, we are not explicitly handling tour state here, but it's a consideration
    }
  }, [isDesktop]);

  // --- React Joyride step definitions ---
  useEffect(() => {
    if (bookData) { 
      const steps: Step[] = [
        {
          target: '[data-tourid="details-button"]',
          content: "Input Book title and Child's name for the story here.",
          placement: 'top',
          isFixed: true,
          disableScrolling: true,
          disableBeacon: true,
        },
        {
          target: '[data-tourid="cover-button"]',
          content: 'Select your front cover photo by clicking here.',
          placement: 'top',
          isFixed: true,
          disableScrolling: true,
          disableBeacon: true,
        },
        {
          target: '[data-tourid="pages-button"]',
          content: 'Arrange the order of your photos & story pages in this section.',
          placement: 'top',
          isFixed: true,
          disableScrolling: true,
          disableBeacon: true,
        },
        {
          target: '[data-tourid="art-style-button"]',
          content: 'Select art style for the illustration here.',
          placement: 'top',
          isFixed: true,
          disableScrolling: true,
          disableBeacon: true,
        },
        {
          target: '[data-tourid="add-photo-button"]',
          content: 'Add additional photos to your storybook using this button.',
          placement: 'top',
          isFixed: true,
          disableScrolling: true,
          disableBeacon: true,
        },
        {
          target: '[data-tourid="generate-story-button"]',
          content: 'Once previous steps are done, click this to create your story!',
          placement: 'bottom',
          isFixed: true,
          disableScrolling: true,
          disableBeacon: true,
        },
      ];
      setTourSteps(steps);
      // setRunTour(true); // <-- REMOVED: Tour will not start automatically anymore
    }
  }, [bookData, isDesktop]); 

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status, type } = data;

    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      // Update the current step index
      // console.log(`Current step: ${index}, Action: ${action}, Status: ${status}, Type: ${type}`);
    } else if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      // Need to set our state so the tour is finished
      setRunTour(false);
      // Potentially save to localStorage that the user has completed the tour
      // localStorage.setItem('editorTourCompleted', 'true');
    }
    logger.info({ joyrideCallback: data }, "Joyride callback triggered");
  };

  const handleHelpClick = () => {
    setRunTour(true); // Start the tour when help icon is clicked
  };

  const handleTabChange = (tab: EditorTab) => {
    setActiveTab(tab);
    // Control panel visibility
    setIsPagesPanelOpen(tab === 'pages');
    setIsArtStylePanelOpen(tab === 'artStyle');
    setIsCoverPanelOpen(tab === 'cover');
    setIsDetailsPanelOpen(tab === 'details'); // Control Details panel
    
    // No need to specifically set storyboardOrder here, useEffect handles it

    if (tab === 'artStyle') {
      setPendingArtStyle(bookData?.artStyle);
      setPendingWinkifyEnabled(bookData?.isWinkifyEnabled ?? true);
    } else if (tab === 'cover') {
      // setPendingTitle(bookData?.title || ''); // Moved to details
      // setPendingChildName(bookData?.childName || ''); // Moved to details
      setPendingCoverAssetId(bookData?.coverAssetId);
    } else if (tab === 'details') { // Initialize pending details
      setPendingTitle(bookData?.title || '');
      setPendingChildName(bookData?.childName || '');
    }
    logger.info({ bookId, newTab: tab }, "Editor tab changed");
  };
  
  // Handler for changes within StoryboardGrid - Updates local storyboardOrder state
  const handleStoryboardOrderChange = (newPages: StoryboardPage[]) => {
    setTimeout(() => {
        setStoryboardOrder(newPages);
        logger.debug({ bookId }, "Storyboard order state updated (deferred)");
    }, 0);
  };
  
  // Handler for saving the new REORDERED state
  const handleSaveStoryboardOrder = async () => {
    if (!bookData || isSavingOrder) return;
    setIsSavingOrder(true);
    logger.info({ bookId }, "Saving storyboard order...");

    // 1. Find the actual cover page from the main bookData
    const coverPage = bookData.pages.find(p => p.assetId === bookData.coverAssetId);
    
    // 2. Create the final, full ordered list for the API
    const finalOrderedPages = [
        // Ensure cover page (if found) is first with index 0
        ...(coverPage ? [{ ...coverPage, index: 0 }] : []),
        // Map the locally reordered storyboard pages to indices 1, 2, 3...
        ...storyboardOrder.map((page, idx) => ({ ...page, index: idx + 1 }))
    ];

    // 3. Prepare API payload with pageId and NEW index for ALL pages
    const pagesToSave = finalOrderedPages.map(page => ({
      pageId: page.id,
      index: page.index, 
    }));

    try {
      // 4. Call API to save the new indices for all pages
      const response = await fetch(`/api/book/${bookId}/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pages: pagesToSave }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Failed to save page order: ${response.statusText}`);
       
       // Update main bookData state
       setBookData(prevData => prevData ? { 
           ...prevData, 
           pages: finalOrderedPages // Update with the full list that includes cover at index 0
         } : null);
         
       setIsPagesPanelOpen(false); // Close panel
       setPagesConfirmed(true); // Mark pages as confirmed by user
    } catch (error) {
        logger.error({ bookId, error }, "Failed to save storyboard order");
        toast.error(`Failed to save page order: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
        setIsSavingOrder(false);
    }
  };

  // Handlers for pending Art Style changes
  const handlePendingStyleChange = (styleKey: string) => {
    setPendingArtStyle(styleKey);
  };
  const handlePendingWinkifyChange = (enabled: boolean) => {
    setPendingWinkifyEnabled(enabled);
  };

  // Handler for saving the selected Art Style and Winkify setting
  const handleSaveArtStyle = async () => {
    if (!bookData || isSavingArtStyle) return;
    setIsSavingArtStyle(true);
    logger.info({ bookId, style: pendingArtStyle, winkify: pendingWinkifyEnabled }, "Saving art style...");

    // Prepare only the fields that changed or are defined
    const updatePayload: { artStyle?: string | null; isWinkifyEnabled?: boolean } = {};
    if (pendingArtStyle !== undefined) {
      updatePayload.artStyle = pendingArtStyle;
    }
    if (pendingWinkifyEnabled !== undefined) { // Check boolean specifically
        updatePayload.isWinkifyEnabled = pendingWinkifyEnabled;
    }
    
    // Only call API if there's something to update
    if (Object.keys(updatePayload).length === 0) {
        logger.info({ bookId }, "No changes detected in art style or winkify settings.");
        setIsSavingArtStyle(false);
        setIsArtStylePanelOpen(false);
        return; // Exit early if no changes
    }

    try {
      const response = await fetch(`/api/book/${bookId}`, { // Call PATCH on the book ID route
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `Failed to save art style: ${response.statusText}`);
      }

      // Update main bookData state ONLY after successful save
      setBookData(prevData => {
        if (!prevData) return null;
        return { 
            ...prevData, 
            // Only update fields that were actually sent
            ...(updatePayload.artStyle !== undefined && { artStyle: updatePayload.artStyle }),
            ...(updatePayload.isWinkifyEnabled !== undefined && { isWinkifyEnabled: updatePayload.isWinkifyEnabled })
        };
      });
         
       setIsArtStylePanelOpen(false); // Close panel on success

    } catch (error) {
      logger.error({ bookId, error }, "Failed to save art style");
      toast.error(`Failed to save art style: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSavingArtStyle(false);
    }
  };

  // Handlers for pending Cover changes
  const handlePendingCoverAssetSelect = (assetId: string | null) => {
    setPendingCoverAssetId(assetId);
  };

  // Handler for saving the Cover changes
  const handleSaveCover = async () => {
    if (!bookData || isSavingCover) return;
    setIsSavingCover(true);
    // logger.info({ bookId, title: pendingTitle, childName: pendingChildName, coverId: pendingCoverAssetId }, "Saving cover details..."); // Title/ChildName removed
    logger.info({ bookId, coverId: pendingCoverAssetId }, "Saving cover photo...");

    const updatePayload: { title?: string; childName?: string; coverAssetId?: string | null } = {};
    // if (pendingTitle !== bookData.title) updatePayload.title = pendingTitle; // Moved to details
    // if (pendingChildName !== bookData.childName) updatePayload.childName = pendingChildName; // Moved to details
    if (pendingCoverAssetId !== bookData.coverAssetId) updatePayload.coverAssetId = pendingCoverAssetId;

    if (Object.keys(updatePayload).length === 0) {
      // logger.info({ bookId }, "No changes detected in cover details."); // Title/ChildName removed
      logger.info({ bookId }, "No changes detected in cover photo.");
      setIsSavingCover(false);
      setIsCoverPanelOpen(false);
      return; 
    }

    try {
      // Call PATCH /api/book/[bookId]
      const response = await fetch(`/api/book/${bookId}`, { 
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Failed to save cover: ${response.statusText}`);

      // Update main bookData state
      setBookData(prevData => {
        if (!prevData) return null;
        return { 
            ...prevData, 
            // ...(updatePayload.title !== undefined && { title: updatePayload.title }), // Moved
            // ...(updatePayload.childName !== undefined && { childName: updatePayload.childName }), // Moved
            ...(updatePayload.coverAssetId !== undefined && { coverAssetId: updatePayload.coverAssetId })
        };
      });
         
       // Reset completion tracking when cover changes (affects page organization)
       if (updatePayload.coverAssetId !== undefined) {
         setPagesResetKey(prev => prev + 1);
         setPagesConfirmed(false); // Reset pages confirmation when cover changes
       }
         
       setIsCoverPanelOpen(false); // Close panel on success
    } catch (error) {
      logger.error({ bookId, error }, "Failed to save cover details");
      toast.error(`Failed to save cover: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSavingCover(false);
    }
  };

  // Handlers for pending Detail changes (new)
  const handlePendingTitleChange = (title: string) => {
    setPendingTitle(title);
  };
  const handlePendingChildNameChange = (name: string) => {
    setPendingChildName(name);
  };

  // Handler for saving Details (new)
  const handleSaveDetails = async () => {
    if (!bookData || isSavingDetails) return;
    setIsSavingDetails(true);
    logger.info({ bookId, title: pendingTitle, childName: pendingChildName }, "Saving book details...");

    const updatePayload: { title?: string; childName?: string; } = {};
    if (pendingTitle !== bookData.title) updatePayload.title = pendingTitle;
    if (pendingChildName !== bookData.childName) updatePayload.childName = pendingChildName;

    if (Object.keys(updatePayload).length === 0) {
      logger.info({ bookId }, "No changes detected in book details.");
      setIsSavingDetails(false);
      setIsDetailsPanelOpen(false);
      return; 
    }

    try {
      const response = await fetch(`/api/book/${bookId}`, { 
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Failed to save details: ${response.statusText}`);

      setBookData(prevData => {
        if (!prevData) return null;
        return { 
            ...prevData, 
            ...(updatePayload.title !== undefined && { title: updatePayload.title }),
            ...(updatePayload.childName !== undefined && { childName: updatePayload.childName }),
        };
      });
         
       setIsDetailsPanelOpen(false);
    } catch (error) {
      logger.error({ bookId, error }, "Failed to save book details");
      toast.error(`Failed to save details: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSavingDetails(false);
    }
  };

  // Type for Cloudinary asset
  interface CloudinaryAsset {
    publicId: string;
    url: string;
    thumbnailUrl: string;
    format: string;
    bytes: number;
    width: number;
    height: number;
  }

  // Handle creation of database records for uploaded assets with bookId
  const createAssetRecordsWithBook = async (cloudinaryAssets: CloudinaryAsset[]): Promise<void> => {
    const token = await getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    try {
      const response = await fetch('/api/cloudinary/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ assets: cloudinaryAssets, bookId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create asset records');
      }

      logger.info({ bookId }, "Asset records created with pages");
    } catch (error) {
      logger.error({ error }, "Failed to create asset records");
      throw error;
    }
  };

  // Handle Cloudinary upload completion
  const handleCloudinaryUploadComplete = async (cloudinaryAssets: CloudinaryAsset[]) => {
    logger.info({ count: cloudinaryAssets.length, bookId }, "Cloudinary uploads completed for book");
    
    try {
      // Create database records and pages
      await createAssetRecordsWithBook(cloudinaryAssets);
      
      // Reset completion states when new photos are added
      setPagesResetKey(prev => prev + 1);
      setPagesConfirmed(false);
      
      // Refresh book data
      await fetchBookData();
      
      toast.success(`Successfully added ${cloudinaryAssets.length} photo(s)`);
      setShowPhotoUploadProgress(false);
      setShowCloudinaryUploader(false);
    } catch (error) {
      logger.error({ error }, "Failed to process additional uploads");
      toast.error(`Failed to add photos: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setShowPhotoUploadProgress(false);
      setShowCloudinaryUploader(false);
    }
  };

  const handleCloudinaryUploadStart = () => {
    setShowPhotoUploadProgress(true);
    setIsPhotoSheetOpen(false);
    setShowCloudinaryUploader(false);
  };

  const handleCloudinaryUploadProgress = (_progress: number, _currentFile: number, _totalFiles: number) => {
    // Progress is handled by the AdditionalPhotoUploadProgressScreen
  };

  const handleCloudinaryUploadCancel = () => {
    logger.info({ bookId }, "Additional photo upload cancelled");
    setShowCloudinaryUploader(false);
    setShowPhotoUploadProgress(false);
  };

  const triggerAddPhotoUpload = () => {
    setIsPhotoSheetOpen(false);
    setShowCloudinaryUploader(true);
  };

  const handleAddPhotoClick = () => {
    logger.info({ bookId }, "Add photo clicked");
    setIsPhotoSheetOpen(true);
  };

  // Keep old handler for backwards compatibility but unused
  const handleAddPhotoUploadComplete = () => {
     logger.info({ bookId }, "Additional photos uploaded, refetching book data.");
     // Reset completion states when new photos are added
     setPagesResetKey(prev => prev + 1);
     setPagesConfirmed(false); // Reset pages confirmation when new photos are added
     fetchBookData(); // <-- Now defined above
  };

  const handleAddPhotoFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
       const files = Array.from(event.target.files);
       setIsPhotoSheetOpen(false); 
       setShowPhotoUploadProgress(true); // <-- Show progress screen
       toast.info(`Uploading ${files.length} additional photo(s)...`);
       logger.info({ bookId, fileCount: files.length }, "Additional photo upload initiated");
       
       const formData = new FormData();
       files.forEach((file) => formData.append('files', file));
       // Add bookId to the form data
       if (bookId) {
           formData.append('bookId', bookId);
       } else {
           logger.error("Cannot add photo: bookId is missing in editor page state.");
           toast.error("Cannot add photo: Book ID is missing.");
           setShowPhotoUploadProgress(false);
           if (fileInputRef.current) fileInputRef.current.value = ''; 
           return;
       }
       
       try {
          const response = await fetch('/api/upload', { method: 'POST', body: formData });
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Upload failed: ${response.statusText}`);
          }
          const result = await response.json();
          // Handle the response format from upload API
          // API returns { success: true, data: assetData } for single file
          // or { success: true, data: { assets: [...] } } for multiple files
          if (result.success && result.data) {
              // Call completion handler which triggers refetch
              handleAddPhotoUploadComplete(); 
              toast.success(`Successfully uploaded ${files.length} photo(s)`);
          } else {
              toast.warning("Upload completed, but no new assets were processed.");
          }
       } catch (error) {
          console.error("Add Photo Upload Error:", error);
          toast.error(`Error adding photos: ${error instanceof Error ? error.message : 'Unknown error'}`);
       } finally {
          setShowPhotoUploadProgress(false); // <-- Hide progress screen
          if (fileInputRef.current) fileInputRef.current.value = ''; 
       }
    }
  };
  
  // Placeholder for Google Photos import
  const handleImportFromGooglePhotos = () => {
    toast.info("Import from Google Photos is coming soon!");
  };

  // -----------------------------------------------------

  // --- Calculate Derived Data for Panels --- 
  const allBookAssets = useMemo(() => {
    if (!bookData?.pages) return [];
    // Extract unique assets from all pages
    const assetsMap = new Map<string, Asset>();
    bookData.pages.forEach(page => {
        if (page.asset) {
            assetsMap.set(page.asset.id, page.asset as Asset); // Ensure full Asset type
        }
    });
    return Array.from(assetsMap.values());
  }, [bookData?.pages]);

  const storyboardPagesForGrid = storyboardOrder; 
  // ------------------------------------------

  // Check if required fields are filled to enable generation
  const canGenerate = useMemo(() => {
      return !!(
          bookData &&
          bookData.title?.trim() && 
          bookData.childName?.trim() && 
          bookData.artStyle
          // Add other required checks here if needed
      );
  }, [bookData]);
  // ----------------------------
  
  // Placeholder for triggering generation - Updated
  const handleGenerateStory = async () => {
      if (!canGenerate || isGeneratingStory) return;
      setIsGeneratingStory(true);
      logger.info({ bookId }, "Triggering story generation via API...");
      
      try {
        const response = await fetch(`/api/generate/story`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookId }), // Send bookId
        });

        if (response.status === 202) {
            toast.info("Story generation started!");
            setShowGenerationProgress(true); // <-- Show the progress screen
        } else {
            const errorData = await response.json().catch(() => ({ error: "Unknown API error" }));
            throw new Error(errorData.error || `Failed to start generation: ${response.statusText}`);
        }

      } catch (error) {
          logger.error({ bookId, error }, "Failed to trigger story generation API");
          toast.error(`Error starting generation: ${error instanceof Error ? error.message : 'Unknown error'}`);
          setIsGeneratingStory(false); // Reset loading state on error
      }
      // Loading state (isGeneratingStory) will remain true until progress screen calls back
  };
  
  // Callback from WritingProgressScreen on completion
  const handleGenerationComplete = (completedBookId: string) => {
      setShowGenerationProgress(false);
      setIsGeneratingStory(false); 
      router.push(`/create/review?bookId=${completedBookId}`); // Navigate to review page
  };

  // Callback from WritingProgressScreen on error/timeout
  const handleGenerationError = (_failedBookId: string, errorMsg?: string) => {
      setShowGenerationProgress(false);
      setIsGeneratingStory(false); 
      // Optionally display the error message from the callback
      toast.error(errorMsg || "Story generation failed or timed out.");
  };

  // --- Step Completion Tracking Logic ---
  // This system tracks which editor steps have been completed to provide visual feedback
  // to users about their progress through the book creation workflow.
  useEffect(() => {
    if (!bookData) return;

    const newCompletedSteps = new Set<EditorTab>();

    // Details: completed if both title and childName are set
    if (bookData.title && bookData.title.trim() && bookData.childName && bookData.childName.trim()) {
      newCompletedSteps.add('details');
    }

    // Cover: completed if coverAssetId is set
    if (bookData.coverAssetId) {
      newCompletedSteps.add('cover');
    }

    // Pages: completed if there's a cover set AND there are remaining pages for the story AND user has confirmed the order
    if (bookData.coverAssetId && pagesConfirmed) {
      const nonCoverPages = bookData.pages.filter(page => page.assetId !== bookData.coverAssetId);
      if (nonCoverPages.length > 0) {
        newCompletedSteps.add('pages');
      }
    }

    // Art Style: completed if artStyle is set
    if (bookData.artStyle) {
      newCompletedSteps.add('artStyle');
    }

    setCompletedSteps(newCompletedSteps);
  }, [bookData, pagesResetKey, pagesConfirmed]);

  // Reset completion tracking when significant changes occur
  // The pagesResetKey is incremented when:
  // - New photos are added (handleAddPhotoUploadComplete)
  // - Pages are reordered (after save completes)
  // - Cover is changed (may affect page organization)
  // When pagesResetKey changes, pagesConfirmed is also reset to false
  useEffect(() => {
    // This effect triggers re-evaluation of completion status
    // whenever pagesResetKey changes, ensuring users review steps
    // after structural changes to their book
  }, [pagesResetKey]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-12 w-12 animate-spin text-[#F76C5E]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-red-600">
        <p className="mb-4">Error loading book:</p>
        <p className="mb-4">{error}</p>
        <button onClick={() => router.push('/create')} className="px-4 py-2 bg-pink-500 text-white rounded hover:bg-pink-600">
          Go Back
        </button>
      </div>
    );
  }

  if (!bookData) {
    // This state might be brief if loading finishes but data is null before error is set
    return (
      <div className="flex items-center justify-center min-h-screen">
        Book not found or failed to load.
      </div>
    );
  }

  // Function to render content based on active tab
  const renderContent = () => {
    if (!bookData) return null; // Guard against null bookData
    switch (activeTab) {
      case 'cover':
      case 'artStyle': 
      case 'details': // Show canvas for details tab too
        return <Canvas bookData={bookData} />; 
      case 'pages':
        return <Canvas bookData={bookData} />; // Keep showing canvas behind sheet/drawer
      default:
        return <Canvas bookData={bookData} />; // Default to cover/canvas
    }
  };

  // ---- Helper to render Storyboard content + footer (reused by Sheet & Drawer) ---- 
  const StoryboardPanelContent = (
    <>
      <div className="flex-grow overflow-auto py-4 px-2">
        {bookData && (
          <StoryboardGrid 
            pages={storyboardPagesForGrid} // <-- Pass the state variable
            onOrderChange={handleStoryboardOrderChange} 
          />
        )}
      </div>
      <DrawerFooter className="pt-2 flex-row">
        <Button 
          onClick={handleSaveStoryboardOrder} 
          disabled={isSavingOrder}
          className="flex-grow bg-[#F76C5E] hover:bg-[#F76C5E]/90 text-white"
        >
          {isSavingOrder ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Done
        </Button>
        <DrawerClose asChild>
          <Button variant="outline" className="flex-grow" disabled={isSavingOrder}>Cancel</Button>
        </DrawerClose>
      </DrawerFooter>
    </>
  );
  // --------------------------------------------------------------------------------

  // ---- Helper to render Art Style content + footer ---- 
  const ArtStylePanelContent = (
    <>
      <div className="flex-grow overflow-auto py-4 px-2">
        {bookData && (
          <ArtStylePicker
            currentStyle={pendingArtStyle} // Use pending state
            isWinkifyEnabled={pendingWinkifyEnabled} // Use pending state
            onStyleChange={handlePendingStyleChange}
            onWinkifyChange={handlePendingWinkifyChange}
          />
        )}
      </div>
      <DrawerFooter className="pt-2 flex-row">
        <Button 
          onClick={handleSaveArtStyle} 
          disabled={isSavingArtStyle}
          className="flex-grow bg-[#F76C5E] hover:bg-[#F76C5E]/90 text-white"
        >
          {isSavingArtStyle ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Done
        </Button> 
        <DrawerClose asChild>
          <Button variant="outline" className="flex-grow" disabled={isSavingArtStyle}>Cancel</Button>
        </DrawerClose>
      </DrawerFooter>
    </>
  );
  // ---------------------------------------------------

  // ---- Helper to render Cover Editor Panel Content + Footer ----
  const CoverPanelContent = (
    <>
      <div className="flex-grow overflow-auto py-4 px-2">
        {bookData && (
          <CoverEditorPanel
            allBookAssets={allBookAssets} 
            currentCoverAssetId={pendingCoverAssetId} 
            // currentTitle={pendingTitle} // Removed
            // currentChildName={pendingChildName} // Removed
            onCoverAssetSelect={handlePendingCoverAssetSelect}
            // onTitleChange={handlePendingTitleChange} // Removed
            // onChildNameChange={handlePendingChildNameChange} // Removed
          />
        )}
      </div>
      <DrawerFooter className="pt-2 flex-row">
        <Button 
          onClick={handleSaveCover} 
          disabled={isSavingCover}
          className="flex-grow bg-[#F76C5E] hover:bg-[#F76C5E]/90 text-white"
        >
          {isSavingCover ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Done
        </Button> 
        <DrawerClose asChild>
          <Button variant="outline" className="flex-grow" disabled={isSavingCover}>Cancel</Button>
        </DrawerClose>
      </DrawerFooter>
    </>
  );
  // -------------------------------------------------------------

  // Main Editor Layout
  return (
    <>
      {showGenerationProgress ? (
        <WritingProgressScreen 
          bookId={bookId}
          onComplete={handleGenerationComplete}
          onError={handleGenerationError}
        />
      ) : showPhotoUploadProgress ? ( // <-- Conditionally render photo upload progress
        <AdditionalPhotoUploadProgressScreen />
      ) : (
        <div className="flex flex-col h-screen bg-gray-100">
          {/* Hidden file input for adding photos later */}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleAddPhotoFileInputChange} 
            className="hidden" 
            multiple 
            accept="image/jpeg,image/png,image/heic,image/heif" 
          />
          
          {/* 1. Top Bar - Updated with 3-column layout */}
          <div className="bg-white shadow-md h-16 flex items-center justify-between px-4 sticky top-0 z-30">
            {/* Left Section (Placeholder) */}
            <div className="flex-1 flex justify-start">
                 {/* TODO: Back button or Menu? */}
                 {/* Example: <Button variant=\"ghost\" size=\"icon\"><ArrowLeft /></Button> */}
                 <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={handleHelpClick} aria-label="Show help tour">
                          <HelpCircle className="h-12 w-12 text-gray-600 hover:text-[#F76C5E]" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Show Editor Hints</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
            </div>
            {/* Center Section (Title) - REMOVED */}
            {/* 
            <div className=\"flex-1 flex justify-center min-w-0\"> 
                <h1 className=\"text-center font-semibold truncate px-2\">{bookData?.title || \'Untitled Storybook\'}</h1> 
            </div>
            */}
            {/* Ensure center column placeholder exists if needed for spacing, or adjust flex */}
            <div className="flex-1"></div> {/* Empty middle column for spacing */} 
            {/* Right Section (Generate Button) */}
            <div className="flex-1 flex justify-end">
              <TooltipProvider delayDuration={100}>
                 <Tooltip>
                    <TooltipTrigger asChild>
                       {/* Wrap button in span for Tooltip when disabled */}
                       <span tabIndex={canGenerate ? -1 : 0}>
                          <Button 
                            data-tourid="generate-story-button" // <-- Added data-tourid for Joyride
                            onClick={handleGenerateStory}
                            disabled={!canGenerate || isGeneratingStory}
                            size="sm" // Smaller button size
                            className={cn(
                              "transition-colors duration-200",
                              canGenerate && !isGeneratingStory
                                ? "bg-[#F76C5E] text-white hover:bg-[#F76C5E]/90"
                                : "bg-gray-400 text-white cursor-not-allowed hover:bg-gray-400"
                            )}
                          >
                            {isGeneratingStory ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 
                            ) : (
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                            )}
                            Generate Story
                          </Button>
                       </span>
                    </TooltipTrigger>
                    {!canGenerate && (
                        <TooltipContent>
                            <p>Please set Title, Child's Name, and Art Style first.</p>
                        </TooltipContent>
                    )}
                 </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* 2. Main Content Area - Removed flex-grow and items-center */}
          <div className="overflow-auto p-4"> 
             {renderContent()} 
          </div>

          {/* 3. Bottom Toolbar */}
          <BottomToolbar 
            activeTab={activeTab}
            onTabChange={handleTabChange}
            onAddPhotoClick={handleAddPhotoClick}
            completedSteps={completedSteps}
          />
          
          {/* ---- Conditionally Render Panels based on activeTab AND isDesktop ---- */} 
          
          {/* Details Panel (New) */} 
          {activeTab === 'details' && (
            isDesktop ? (
              <Drawer open={isDetailsPanelOpen} onOpenChange={setIsDetailsPanelOpen}>
                <DrawerContent className="h-full w-[380px] mt-0 fixed left-0 rounded-none border-r"> 
                  <DrawerHeader><DrawerTitle>Book Details</DrawerTitle></DrawerHeader>
                  <DetailsEditorPanel 
                    currentTitle={pendingTitle}
                    currentChildName={pendingChildName}
                    onTitleChange={handlePendingTitleChange}
                    onChildNameChange={handlePendingChildNameChange}
                    onSave={handleSaveDetails}
                    onCancel={() => setIsDetailsPanelOpen(false)} // Close panel on cancel
                    isSaving={isSavingDetails}
                  />
                </DrawerContent>
              </Drawer>
            ) : (
              <Sheet open={isDetailsPanelOpen} onOpenChange={setIsDetailsPanelOpen}>
                 <SheetContent side="bottom" className="h-[85vh] flex flex-col"> 
                   <SheetHeader><SheetTitle>Book Details</SheetTitle></SheetHeader>
                   <DetailsEditorPanel 
                    currentTitle={pendingTitle}
                    currentChildName={pendingChildName}
                    onTitleChange={handlePendingTitleChange}
                    onChildNameChange={handlePendingChildNameChange}
                    onSave={handleSaveDetails}
                    onCancel={() => setIsDetailsPanelOpen(false)} // Close panel on cancel
                    isSaving={isSavingDetails}
                  />
                 </SheetContent>
              </Sheet>
            )
          )}

          {/* Cover Panel */} 
          {activeTab === 'cover' && (
            isDesktop ? (
              <Drawer open={isCoverPanelOpen} onOpenChange={setIsCoverPanelOpen}>
                <DrawerContent className="h-full w-[380px] mt-0 fixed left-0 rounded-none border-r"> 
                  <DrawerHeader><DrawerTitle>Select your front cover</DrawerTitle></DrawerHeader>
                  {CoverPanelContent} 
                </DrawerContent>
              </Drawer>
            ) : (
              <Sheet open={isCoverPanelOpen} onOpenChange={setIsCoverPanelOpen}>
                 <SheetContent side="bottom" className="h-[85vh] flex flex-col"> 
                   <SheetHeader><SheetTitle>Select your front cover</SheetTitle></SheetHeader>
                   {CoverPanelContent} 
                 </SheetContent>
              </Sheet>
            )
          )}

          {/* Pages Panel */} 
          {activeTab === 'pages' && (
            isDesktop ? (
              <Drawer open={isPagesPanelOpen} onOpenChange={setIsPagesPanelOpen}>
                <DrawerContent className="h-full w-[380px] mt-0 fixed left-0 rounded-none border-r"> 
                  <DrawerHeader>
                      <DrawerTitle>Pages Overview</DrawerTitle>
                      <DrawerDescription>Drag photos to rearrange pages.</DrawerDescription>
                  </DrawerHeader>
                  {StoryboardPanelContent} 
                </DrawerContent>
              </Drawer>
            ) : (
              <Sheet open={isPagesPanelOpen} onOpenChange={setIsPagesPanelOpen}>
                 <SheetContent side="bottom" className="h-screen flex flex-col"> 
                   <SheetHeader>
                       <SheetTitle>Pages Overview</SheetTitle>
                       <DrawerDescription>Drag photos to rearrange pages.</DrawerDescription> 
                   </SheetHeader>
                   {StoryboardPanelContent} 
                 </SheetContent>
              </Sheet>
            )
          )}

          {/* Art Style Panel */} 
          {activeTab === 'artStyle' && (
            isDesktop ? (
              <Drawer open={isArtStylePanelOpen} onOpenChange={setIsArtStylePanelOpen}>
                <DrawerContent className="h-full w-[380px] mt-0 fixed left-0 rounded-none border-r"> 
                  <DrawerHeader><DrawerTitle>Choose Art Style</DrawerTitle></DrawerHeader>
                  {ArtStylePanelContent} 
                </DrawerContent>
              </Drawer>
            ) : (
              <Sheet open={isArtStylePanelOpen} onOpenChange={setIsArtStylePanelOpen}>
                 <SheetContent side="bottom" className="h-screen flex flex-col"> 
                   <SheetHeader><SheetTitle>Choose Art Style</SheetTitle></SheetHeader>
                   {ArtStylePanelContent} 
                 </SheetContent>
              </Sheet>
            )
          )}
          {/* -------------------------------------------------------- */}
          
          {/* PhotoSourceSheet for adding photos - Remains unchanged */}
          <PhotoSourceSheet
            isOpen={isPhotoSheetOpen}
            onOpenChange={setIsPhotoSheetOpen}
            onChooseFromPhone={triggerAddPhotoUpload}
            onImportFromGooglePhotos={handleImportFromGooglePhotos}
          />

          {/* Invisible Cloudinary uploader that auto-opens */}
          {showCloudinaryUploader && !showPhotoUploadProgress && (
            <CloudinaryUploaderAuto
              onUploadComplete={handleCloudinaryUploadComplete}
              onUploadStart={handleCloudinaryUploadStart}
              onUploadProgress={handleCloudinaryUploadProgress}
              onCancel={handleCloudinaryUploadCancel}
            />
          )}

          {/* --- React Joyride Component --- */}
          {tourSteps.length > 0 && (
            <Joyride
              steps={tourSteps}
              run={runTour}
              callback={handleJoyrideCallback}
              continuous
              showProgress={false}
              showSkipButton
              scrollToFirstStep={false}
              debug={true}
              locale={{
                next: 'Next',
                back: 'Back',
                skip: 'Skip',
                last: 'Done',
                close: 'Close',
              }}
              // Styles to match brand color and improve mobile experience
              styles={{
                options: {
                  zIndex: 10000, // Ensure it's above other elements like sheets/drawers
                  arrowColor: '#FFFFFF',
                  backgroundColor: '#FFFFFF',
                  primaryColor: '#F76C5E', // Brand color for buttons/dots
                  textColor: '#333333',
                  
                },
                tooltip: {
                  borderRadius: '8px',
                  fontSize: isDesktop ? 15 : 14,
                  padding: isDesktop ? 16: 12,
                },
                tooltipContainer: {
                  textAlign: 'left',
                },
                buttonNext: {
                  borderRadius: '4px',
                  fontSize: isDesktop ? 14 : 13,
                  padding: '8px 12px',
                },
                buttonBack: {
                  borderRadius: '4px',
                  fontSize: isDesktop ? 14 : 13,
                  marginRight: 10,
                  padding: '8px 12px',
                },
                buttonSkip: {
                  fontSize: isDesktop ? 14 : 13,
                  color: '#555555',
                },
                // For mobile, beacon and spotlight might need adjustments
                // For now, using disableBeacon on steps.
                // spotlight: {
                //   borderRadius: '4px', 
                // },
              }}
            />
          )}
          {/* ----------------------------- */}
        </div>
      )}
    </>
  );
} 