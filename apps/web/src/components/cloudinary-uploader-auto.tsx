"use client";

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { CldUploadWidget } from 'next-cloudinary';
import { useUser } from '@clerk/nextjs';
import logger from '@/lib/logger';
import { toast } from 'sonner';

interface CloudinaryUploaderAutoProps {
  onUploadComplete: (assets: CloudinaryAsset[]) => void;
  onUploadStart?: (totalFiles: number) => void;
  onUploadProgress?: (progress: number, currentFile: number, totalFiles: number) => void;
  onCancel?: () => void;
}

interface CloudinaryAsset {
  publicId: string;
  url: string;
  thumbnailUrl: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
}

interface CloudinaryResult {
  public_id: string;
  secure_url: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  thumbnail_url?: string;
  eager?: Array<{ secure_url: string }>;
}

/**
 * Classifies upload errors and returns user-friendly messages with guidance
 */
const getUploadErrorMessage = (error: any): { title: string; description: string } => {
  const message = error?.message?.toLowerCase() || '';
  const statusText = error?.statusText?.toLowerCase() || '';
  const combined = `${message} ${statusText}`;

  // Timeout errors - likely cloud-backed photos
  if (combined.includes('timeout') || combined.includes('timed out') || combined.includes('aborted')) {
    return {
      title: 'Upload timed out',
      description: 'Some photos may be stored in iCloud or Google Photos. Please open them in your Photos app first to download them, then try again.'
    };
  }

  // Network errors
  if (combined.includes('network') || combined.includes('fetch') || combined.includes('connection') || combined.includes('offline')) {
    return {
      title: 'Network error',
      description: 'Please check your internet connection and try again.'
    };
  }

  // File access errors - could indicate cloud placeholder
  if (combined.includes('access') || combined.includes('permission') || combined.includes('read') || combined.includes('denied')) {
    return {
      title: 'Could not access photo',
      description: 'This photo may be stored in the cloud. Please open it in your Photos app first to download it locally.'
    };
  }

  // File size errors
  if (combined.includes('size') || combined.includes('large') || combined.includes('limit') || combined.includes('exceed')) {
    return {
      title: 'Photo too large',
      description: 'Please select a smaller photo (max 10MB).'
    };
  }

  // Format errors
  if (combined.includes('format') || combined.includes('type') || combined.includes('unsupported') || combined.includes('invalid')) {
    return {
      title: 'Unsupported format',
      description: 'Please use JPG, PNG, or WebP photos.'
    };
  }

  // Generic fallback with helpful hint about cloud photos
  return {
    title: 'Upload failed',
    description: 'If you\'re uploading older photos, try opening them in your Photos app first to ensure they\'re downloaded from iCloud or Google Photos.'
  };
};

// This component automatically opens the Cloudinary widget when mounted
export function CloudinaryUploaderAuto({
  onUploadComplete,
  onUploadStart,
  onUploadProgress,
  onCancel
}: CloudinaryUploaderAutoProps) {
  const { user } = useUser();
  const widgetRef = useRef<any>(null);
  const uploadedAssets = useRef<CloudinaryAsset[]>([]);
  const currentFileIndex = useRef(0);
  const totalFiles = useRef(0);
  const hasOpened = useRef(false);
  const hasCalledComplete = useRef(false);
  const openFunctionRef = useRef<(() => void) | null>(null);
  const [widgetIsLoading, setWidgetIsLoading] = useState(true);
  const wasLoadingRef = useRef(true);

  // Helper function to check if uploads are complete and trigger callback
  const checkAndTriggerCompletion = useCallback(() => {
    // Prevent duplicate calls
    if (hasCalledComplete.current) {
      return;
    }

    const hasUploads = uploadedAssets.current.length > 0;
    const hasQueueInfo = totalFiles.current > 0;
    const allUploadsComplete = hasQueueInfo && currentFileIndex.current === totalFiles.current;
    
    // Case 1: We have queue info and all uploads are complete
    if (hasUploads && allUploadsComplete) {
      logger.info({ 
        assetCount: uploadedAssets.current.length,
        currentFileIndex: currentFileIndex.current,
        totalFiles: totalFiles.current 
      }, "All uploads complete - calling onUploadComplete");
      
      hasCalledComplete.current = true;
      onUploadComplete(uploadedAssets.current);
      
      // Reset state for next upload
      uploadedAssets.current = [];
      currentFileIndex.current = 0;
      totalFiles.current = 0;
      return;
    }
    
    // Case 2: We have uploads but no queue info (race condition)
    // This can happen if uploads complete before onQueuesEnd fires
    if (hasUploads && !hasQueueInfo) {
      // We'll wait for either the queue info or the widget to close
      logger.info({ 
        assetCount: uploadedAssets.current.length 
      }, "Uploads complete but waiting for queue info");
    }
  }, [onUploadComplete]);

  const handleUploadSuccess = useCallback((result: any) => {
    logger.info({ 
      publicId: result.info.public_id,
      currentFileIndex: currentFileIndex.current,
      totalFiles: totalFiles.current 
    }, "Cloudinary upload success");
    
    const cloudinaryResult = result.info as CloudinaryResult;
    
    // Extract thumbnail URL from eager transformations or generate it
    const thumbnailUrl = cloudinaryResult.eager?.[0]?.secure_url || 
      cloudinaryResult.secure_url.replace('/upload/', '/upload/c_fill,h_200,w_200,q_auto,f_auto/');
    
    const asset: CloudinaryAsset = {
      publicId: cloudinaryResult.public_id,
      url: cloudinaryResult.secure_url,
      thumbnailUrl: thumbnailUrl,
      format: cloudinaryResult.format,
      bytes: cloudinaryResult.bytes,
      width: cloudinaryResult.width,
      height: cloudinaryResult.height,
    };

    uploadedAssets.current = [...uploadedAssets.current, asset];
    currentFileIndex.current = currentFileIndex.current + 1;

    // Update progress
    if (onUploadProgress && totalFiles.current > 0) {
      const progress = Math.round((currentFileIndex.current / totalFiles.current) * 100);
      onUploadProgress(progress, currentFileIndex.current, totalFiles.current);
    }

    // Check if all uploads are complete
    checkAndTriggerCompletion();
  }, [checkAndTriggerCompletion, onUploadProgress]);

  const handleUploadError = useCallback((error: any) => {
    // Enhanced logging for debugging
    logger.error({
      error,
      errorMessage: error?.message,
      statusText: error?.statusText,
      errorCode: error?.code
    }, "Cloudinary upload error");

    // Get user-friendly error message with guidance
    const { title, description } = getUploadErrorMessage(error);

    // Show toast with title and description for better user guidance
    toast.error(title, {
      description,
      duration: 8000, // Longer duration so users can read the guidance
    });

    // Reset state
    uploadedAssets.current = [];
    currentFileIndex.current = 0;
    totalFiles.current = 0;

    // Call cancel callback
    if (onCancel) {
      onCancel();
    }
  }, [onCancel]);

  const handleUploadOpen = useCallback(() => {
    logger.info("Cloudinary widget opened");
    hasOpened.current = true;
  }, []);

  const handleUploadClose = useCallback(() => {
    logger.info({
      uploadedAssets: uploadedAssets.current.length,
      currentFileIndex: currentFileIndex.current,
      totalFiles: totalFiles.current,
      hasCalledComplete: hasCalledComplete.current
    }, "Cloudinary widget closed");
    
    // If we haven't called complete yet and have uploads
    if (!hasCalledComplete.current && uploadedAssets.current.length > 0) {
      // Case 1: We have queue info and counts match
      if (totalFiles.current > 0 && uploadedAssets.current.length === totalFiles.current) {
        logger.info("Widget closed after successful uploads - calling onUploadComplete");
        hasCalledComplete.current = true;
        onUploadComplete(uploadedAssets.current);
        
        // Reset state for next upload
        uploadedAssets.current = [];
        currentFileIndex.current = 0;
        totalFiles.current = 0;
      } 
      // Case 2: We have uploads but no queue info (race condition)
      else if (totalFiles.current === 0) {
        logger.info({
          uploadCount: uploadedAssets.current.length
        }, "Widget closed with uploads but no queue info - calling onUploadComplete anyway");
        hasCalledComplete.current = true;
        onUploadComplete(uploadedAssets.current);
        
        // Reset state for next upload
        uploadedAssets.current = [];
        currentFileIndex.current = 0;
        totalFiles.current = 0;
      }
    } else if (uploadedAssets.current.length === 0 && onCancel) {
      // If no files were uploaded and widget was closed, call cancel
      logger.info("No files uploaded - calling onCancel");
      onCancel();
    }
  }, [onCancel, onUploadComplete]);

  const handleUploadAdded = useCallback((result: any) => {
    // Log file info for debugging upload issues
    logger.info({
      fileName: result?.info?.original_filename,
      fileSize: result?.info?.bytes,
      fileType: result?.info?.type,
    }, "File added to upload queue");
  }, []);

  const handleUploadQueuesEnd = useCallback((result: any) => {
    logger.info({ fileCount: result.info.files.length }, "Upload queue started");
    totalFiles.current = result.info.files.length;
    
    // Only call onUploadStart when files are actually being uploaded
    if (result.info.files.length > 0 && onUploadStart) {
      onUploadStart(result.info.files.length);
    }
    
    // Check if uploads already completed (race condition)
    checkAndTriggerCompletion();
  }, [checkAndTriggerCompletion, onUploadStart]);

  // Generate folder path based on user ID
  const folder = user ? `user_${user.id}/uploads` : 'uploads';

  // Build upload options
  const uploadOptions = {
    uploadPreset: 'storywink_unsigned',
    folder: folder,
    sources: ['local', 'camera'] as ('local' | 'camera')[],
    multiple: true,
    maxFiles: 20,
    // Only allow formats that OpenAI Vision API supports (no HEIC/HEIF)
    clientAllowedFormats: ['jpg', 'jpeg', 'png', 'webp'],
    maxFileSize: 10485760, // 10MB
    showAdvancedOptions: false,
    showCompletedButton: true,
    showUploadMoreButton: true,
    singleUploadAutoClose: false,
    styles: {
      palette: {
        window: "#FFFFFF",
        windowBorder: "#90A0B3",
        tabIcon: "#F76C5E",
        menuIcons: "#5A616A",
        textDark: "#000000",
        textLight: "#FFFFFF",
        link: "#F76C5E",
        action: "#F76C5E",
        inactiveTabIcon: "#B8C0C8",
        error: "#F44235",
        inProgress: "#F76C5E",
        complete: "#20B832",
        sourceBg: "#FAFAFA"
      }
    },
    text: {
      en: {
        menu: {
          files: "Choose Photos",
          camera: "Take Photo"
        },
        or: "or",
        button: {
          upload: "Upload Photos"
        },
        local: {
          browse: "Browse",
          dd_title_single: "Drag and drop photo here",
          dd_title_multi: "Drag and drop photos here",
          drop_title_single: "Drop photo to upload",
          drop_title_multiple: "Drop photos to upload"
        }
      }
    }
  };

  // Cleanup effect
  useEffect(() => {
    return () => {
      // Reset all state on unmount
      uploadedAssets.current = [];
      currentFileIndex.current = 0;
      totalFiles.current = 0;
      hasCalledComplete.current = false;
    };
  }, []);

  // Store open function - auto-open is now handled by the useEffect that watches widgetIsLoading
  const storeOpenFunction = useCallback((open: () => void) => {
    if (!openFunctionRef.current) {
      openFunctionRef.current = open;
      // Auto-open is triggered by the isLoading effect below, not here
    }
  }, []);

  // Auto-open when widget transitions from loading to ready
  useEffect(() => {
    if (wasLoadingRef.current && !widgetIsLoading && openFunctionRef.current && !hasOpened.current) {
      logger.info("Cloudinary widget ready - auto-opening");
      hasCalledComplete.current = false;
      openFunctionRef.current();
    }
    wasLoadingRef.current = widgetIsLoading;
  }, [widgetIsLoading]);

  return (
    <CldUploadWidget
      uploadPreset="storywink_unsigned"
      options={uploadOptions}
      onSuccess={handleUploadSuccess}
      onError={handleUploadError}
      onOpen={handleUploadOpen}
      onClose={handleUploadClose}
      onQueuesEnd={handleUploadQueuesEnd}
      onUploadAdded={handleUploadAdded}
    >
      {({ open, widget, isLoading }) => {
        // Store widget reference
        widgetRef.current = widget;

        // Sync isLoading to state (must be done outside render via queueMicrotask)
        // isLoading can be undefined initially, so default to true
        const currentLoadingState = isLoading ?? true;
        if (currentLoadingState !== widgetIsLoading) {
          queueMicrotask(() => setWidgetIsLoading(currentLoadingState));
        }

        // Store open function on first render only
        if (open && !openFunctionRef.current) {
          // Use queueMicrotask to defer until after render
          queueMicrotask(() => storeOpenFunction(open));
        }

        // Return empty fragment since we don't want to render anything
        return <></>;
      }}
    </CldUploadWidget>
  );
}