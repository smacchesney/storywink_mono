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
    logger.error({ error }, "Cloudinary upload error");
    toast.error(`Upload failed: ${error.message || 'Unknown error'}`);
    
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