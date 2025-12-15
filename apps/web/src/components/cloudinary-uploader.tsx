"use client";

import React, { useState, useCallback } from 'react';
import { CldUploadWidget } from 'next-cloudinary';
import { UploadCloud, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useUser } from '@clerk/nextjs';
import logger from '@/lib/logger';
import { BOOK_CONSTRAINTS } from '@storywink/shared';

interface CloudinaryUploaderProps {
  onUploadComplete: (assets: CloudinaryAsset[]) => void;
  onUploadStart?: () => void;
  onUploadProgress?: (progress: number, currentFile: number, totalFiles: number) => void;
  className?: string;
  multiple?: boolean;
  maxFiles?: number;
  bookId?: string; // Optional bookId for adding photos to existing book
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

export function CloudinaryUploader({
  onUploadComplete,
  onUploadStart,
  onUploadProgress,
  className,
  multiple = true,
  maxFiles = BOOK_CONSTRAINTS.MAX_PHOTOS
}: CloudinaryUploaderProps) {
  const { user } = useUser();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedAssets, setUploadedAssets] = useState<CloudinaryAsset[]>([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);

  const handleUploadSuccess = useCallback((result: any) => {
    logger.info({ publicId: result.info.public_id }, "Cloudinary upload success");
    
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

    setUploadedAssets(prev => [...prev, asset]);
    setCurrentFileIndex(prev => prev + 1);

    // Update progress
    if (onUploadProgress && totalFiles > 0) {
      const progress = Math.round(((currentFileIndex + 1) / totalFiles) * 100);
      onUploadProgress(progress, currentFileIndex + 1, totalFiles);
    }

    // If this was the last file, trigger completion
    if (currentFileIndex + 1 === totalFiles) {
      const allAssets = [...uploadedAssets, asset];
      logger.info({ assetCount: allAssets.length }, "All uploads complete");
      setIsUploading(false);
      onUploadComplete(allAssets);
      
      // Reset state for next upload
      setUploadedAssets([]);
      setCurrentFileIndex(0);
      setTotalFiles(0);
    }
  }, [uploadedAssets, currentFileIndex, totalFiles, onUploadComplete, onUploadProgress]);

  const handleUploadError = useCallback((error: any) => {
    logger.error({ error }, "Cloudinary upload error");
    setIsUploading(false);
    toast.error(`Upload failed: ${error.message || 'Unknown error'}`);
    
    // Reset state
    setUploadedAssets([]);
    setCurrentFileIndex(0);
    setTotalFiles(0);
  }, []);

  const handleUploadOpen = useCallback(() => {
    logger.info("Cloudinary widget opened");
    setIsUploading(true);
    if (onUploadStart) {
      onUploadStart();
    }
  }, [onUploadStart]);

  const handleUploadQueuesEnd = useCallback((result: any) => {
    logger.info({ fileCount: result.info.files.length }, "Upload queue started");
    setTotalFiles(result.info.files.length);
    setCurrentFileIndex(0);
  }, []);

  // Generate folder path based on user ID
  const folder = user ? `user_${user.id}/uploads` : 'uploads';

  // Build upload options
  const uploadOptions = {
    uploadPreset: 'storywink_unsigned',
    folder: folder,
    sources: ['local', 'camera'] as ('local' | 'camera')[],
    multiple: multiple,
    maxFiles: maxFiles,
    clientAllowedFormats: ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'],
    maxFileSize: 10485760, // 10MB
    showAdvancedOptions: false,
    showCompletedButton: true,
    showUploadMoreButton: multiple,
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

  return (
    <div className={cn("w-full", className)}>
      <CldUploadWidget
        uploadPreset="storywink_unsigned"
        options={uploadOptions}
        onSuccess={handleUploadSuccess}
        onError={handleUploadError}
        onOpen={handleUploadOpen}
        onQueuesEnd={handleUploadQueuesEnd}
      >
        {({ open }) => (
          <button
            onClick={() => open()}
            disabled={isUploading}
            className={cn(
              "w-full border-2 border-dashed rounded-lg p-8 text-center transition-colors duration-200 ease-in-out",
              isUploading 
                ? "border-primary bg-primary/10 cursor-not-allowed" 
                : "border-muted-foreground/50 hover:border-primary hover:bg-primary/5 bg-background cursor-pointer",
              "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            )}
          >
            <div className="flex flex-col items-center justify-center space-y-4">
              {isUploading ? (
                <>
                  <Loader2 className="h-12 w-12 animate-spin text-primary" />
                  <p className="text-muted-foreground">
                    Uploading {currentFileIndex} of {totalFiles} photos...
                  </p>
                  {onUploadProgress && totalFiles > 0 && (
                    <div className="w-full max-w-xs">
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-primary h-2 rounded-full transition-all duration-300"
                          style={{ width: `${Math.round((currentFileIndex / totalFiles) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <UploadCloud className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    Click to upload photos or{" "}
                    <span className="font-semibold text-primary">drag & drop</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Max <span className="font-semibold">{maxFiles}</span> photos per book. JPG, PNG, HEIC, WebP. Up to 10MB each.
                  </p>
                </>
              )}
            </div>
          </button>
        )}
      </CldUploadWidget>
    </div>
  );
}