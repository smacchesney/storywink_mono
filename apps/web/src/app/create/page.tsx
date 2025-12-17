"use client";

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import PhotoSourceSheet from '@/components/create/PhotoSourceSheet';
import { CloudinaryUploaderAuto } from '@/components/cloudinary-uploader-auto';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@clerk/nextjs';
import logger from '@/lib/logger';

// Type for Cloudinary asset from uploader
interface CloudinaryAsset {
  publicId: string;
  url: string;
  thumbnailUrl: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
}

// Type for database asset
interface Asset {
  id: string;
  thumbnailUrl: string;
  url: string;
}

export default function CreateBookPage() {
  const router = useRouter();
  const { getToken, isLoaded } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [showCloudinaryUploader, setShowCloudinaryUploader] = useState(false);
  const [isLoadingUploader, setIsLoadingUploader] = useState(false);

  // Track when loading started for minimum spinner display time
  const loadingStartTimeRef = useRef<number | null>(null);

  // Handle creation of database records for uploaded assets
  const createAssetRecords = async (cloudinaryAssets: CloudinaryAsset[]): Promise<Asset[]> => {
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
        body: JSON.stringify({ assets: cloudinaryAssets }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create asset records');
      }

      const result = await response.json();
      return result.data.assets;
    } catch (error) {
      logger.error({ error }, "Failed to create asset records");
      throw error;
    }
  };

  // Create book with assets
  const handleCreateBook = async (assetIds: string[]) => {
    if (!isLoaded) {
      throw new Error('Authentication not loaded');
    }

    const token = await getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    
    try {
      const response = await apiClient.createBook({
        assetIds,
      }, token);

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Book creation failed');
      }

      return { bookId: (response.data as any).id };
      
    } catch (error) { 
      logger.error({ error }, 'Book Creation API Call Failed');
      toast.error(`Failed to start book creation: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  };

  // Handle upload completion from Cloudinary
  const handleUploadComplete = async (cloudinaryAssets: CloudinaryAsset[]) => {
    logger.info({ count: cloudinaryAssets.length }, "Cloudinary uploads completed");

    // Hide the Cloudinary component now that uploads are done
    setShowCloudinaryUploader(false);

    try {
      // Create database records for the uploaded assets
      const dbAssets = await createAssetRecords(cloudinaryAssets);
      logger.info({ count: dbAssets.length }, "Database assets created");

      if (dbAssets.length > 0) {
        const assetIds = dbAssets.map(asset => asset.id);
        const creationResult = await handleCreateBook(assetIds);

        if (creationResult?.bookId) {
          // Navigate to character selection page (will auto-skip if no faces detected)
          router.push(`/create/${creationResult.bookId}/characters`);
        } else {
          // Error occurred during handleCreateBook
          setIsUploading(false);
        }
      } else {
        toast.warning("No assets were created");
        setIsUploading(false);
      }
    } catch (error) {
      logger.error({ error }, "Failed to process uploads");
      toast.error(`Failed to process uploads: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsUploading(false);
    }
  };

  const handleUploadStart = (totalFiles: number) => {
    logger.info({ totalFiles }, "Upload started");
    setIsUploading(true);
    setIsSheetOpen(false);
  };

  const handleUploadProgress = (_progress: number, _currentFile: number, _totalFiles: number) => {
    // Progress is handled by Cloudinary's built-in widget UI
  };

  const handleStartCreatingClick = () => {
    logger.info("Start Creating clicked - Directly opening Cloudinary uploader");
    // Track when loading started for minimum spinner display
    loadingStartTimeRef.current = Date.now();
    // Show loading spinner while Cloudinary widget loads
    setIsLoadingUploader(true);
    // Skip the PhotoSourceSheet and directly trigger Cloudinary uploader
    setShowCloudinaryUploader(true);
  };

  const handleChooseFromPhone = () => {
    setIsSheetOpen(false);
    // Show the auto-opening Cloudinary uploader
    setShowCloudinaryUploader(true);
  };

  const handleUploadCancel = () => {
    logger.info("Upload cancelled");
    setShowCloudinaryUploader(false);
    setIsUploading(false);
    setIsLoadingUploader(false);
  };

  const handleImportFromGooglePhotos = () => {
    toast.info("Import from Google Photos is coming soon!");
  };

  return (
    <>
      {(!showCloudinaryUploader || isLoadingUploader) && (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] px-4 py-8">
          <Button
            onClick={handleStartCreatingClick}
            disabled={isUploading || isLoadingUploader}
            variant="outline"
            className="relative bg-white rounded-full w-24 h-24 md:w-40 md:h-40 shadow-lg hover:shadow-xl transition-shadow duration-300 ease-in-out flex items-center justify-center group"
          >
            {isLoadingUploader ? (
              <Loader2 className="text-[#F76C5E] w-10 h-10 md:w-16 md:h-16 animate-spin" />
            ) : (
              <Plus className="text-[#F76C5E] w-10 h-10 md:w-16 md:h-16 transition-transform duration-300 ease-in-out group-hover:scale-110" />
            )}
          </Button>

          <p className="mt-4 md:mt-6 text-lg md:text-xl text-gray-600 font-medium">
            Start Creating
          </p>

          <PhotoSourceSheet
            isOpen={isSheetOpen}
            onOpenChange={setIsSheetOpen}
            onChooseFromPhone={handleChooseFromPhone}
            onImportFromGooglePhotos={handleImportFromGooglePhotos}
          />
        </div>
      )}

      {/* Cloudinary uploader that auto-opens */}
      {showCloudinaryUploader && (
        <CloudinaryUploaderAuto
          onUploadComplete={handleUploadComplete}
          onUploadStart={handleUploadStart}
          onUploadProgress={handleUploadProgress}
          onCancel={handleUploadCancel}
          onOpen={() => {
            // Ensure spinner shows for at least 2 seconds (typical widget load time)
            const MIN_LOADING_TIME = 2000;
            const elapsed = Date.now() - (loadingStartTimeRef.current || Date.now());
            const remaining = Math.max(0, MIN_LOADING_TIME - elapsed);

            if (remaining > 0) {
              setTimeout(() => setIsLoadingUploader(false), remaining);
            } else {
              setIsLoadingUploader(false);
            }
          }}
        />
      )}
    </>
  );
}