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
  const [widgetOpen, setWidgetOpen] = useState<(() => void) | null>(null);

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

    // If this was the last file, trigger completion
    if (currentFileIndex.current === totalFiles.current) {
      logger.info({ assetCount: uploadedAssets.current.length }, "All uploads complete");
      onUploadComplete(uploadedAssets.current);
      
      // Reset state for next upload
      uploadedAssets.current = [];
      currentFileIndex.current = 0;
      totalFiles.current = 0;
    }
  }, [onUploadComplete, onUploadProgress]);

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
    logger.info("Cloudinary widget closed");
    
    // If no files were uploaded and widget was closed, call cancel
    if (uploadedAssets.current.length === 0 && onCancel) {
      onCancel();
    }
  }, [onCancel]);

  const handleUploadQueuesEnd = useCallback((result: any) => {
    logger.info({ fileCount: result.info.files.length }, "Upload queue started");
    totalFiles.current = result.info.files.length;
    currentFileIndex.current = 0;
    
    // Only call onUploadStart when files are actually being uploaded
    if (result.info.files.length > 0 && onUploadStart) {
      onUploadStart(result.info.files.length);
    }
  }, [onUploadStart]);

  // Generate folder path based on user ID
  const folder = user ? `user_${user.id}/uploads` : 'uploads';

  // Build upload options
  const uploadOptions = {
    uploadPreset: 'storywink_unsigned',
    folder: folder,
    sources: ['local', 'camera'] as ('local' | 'camera')[],
    multiple: true,
    maxFiles: 20,
    clientAllowedFormats: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'],
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

  // Auto-open effect
  useEffect(() => {
    if (widgetOpen && !hasOpened.current) {
      // Small delay to ensure component is fully mounted
      const timer = setTimeout(() => {
        widgetOpen();
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [widgetOpen]);

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
      {({ open, widget }) => {
        // Store widget reference and open function
        widgetRef.current = widget;
        if (!widgetOpen) {
          setWidgetOpen(() => open);
        }
        
        // Return empty fragment since we don't want to render anything
        return <></>;
      }}
    </CldUploadWidget>
  );
}