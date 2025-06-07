"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import PhotoSourceSheet from '@/components/create/PhotoSourceSheet';
import UploadProgressScreen from '@/components/create/UploadProgressScreen';
import { CloudinaryUploader } from '@/components/cloudinary-uploader';
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
  
  // State for Progress Screen
  const [showProgressScreen, setShowProgressScreen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentUploadFile, setCurrentUploadFile] = useState(0);
  const [totalUploadFiles, setTotalUploadFiles] = useState(0);

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
    
    // Keep progress screen visible while creating database records
    setUploadProgress(90); // Show we're almost done
    
    try {
      // Create database records for the uploaded assets
      const dbAssets = await createAssetRecords(cloudinaryAssets);
      logger.info({ count: dbAssets.length }, "Database assets created");
      
      setUploadProgress(95); // Almost there
      
      if (dbAssets.length > 0) {
        const assetIds = dbAssets.map(asset => asset.id);
        const creationResult = await handleCreateBook(assetIds);
        
        if (creationResult?.bookId) {
          setUploadProgress(100); // Complete!
          // Small delay to show 100% before navigation
          setTimeout(() => {
            router.push(`/create/${creationResult.bookId}/edit`);
          }, 500);
        } else {
          // Error occurred during handleCreateBook
          setShowProgressScreen(false);
          setIsUploading(false);
          setShowCloudinaryUploader(false);
        }
      } else {
        toast.warning("No assets were created");
        setShowProgressScreen(false);
        setIsUploading(false);
        setShowCloudinaryUploader(false);
      }
    } catch (error) {
      logger.error({ error }, "Failed to process uploads");
      toast.error(`Failed to process uploads: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setShowProgressScreen(false);
      setIsUploading(false);
      setShowCloudinaryUploader(false);
    }
  };

  const handleUploadStart = () => {
    setIsUploading(true);
    setShowProgressScreen(true);
    setIsSheetOpen(false);
  };

  const handleUploadProgress = (progress: number, currentFile: number, totalFiles: number) => {
    setUploadProgress(Math.min(progress * 0.9, 90)); // Cap at 90% during upload
    setCurrentUploadFile(currentFile);
    setTotalUploadFiles(totalFiles);
  };

  const handleStartCreatingClick = () => {
    logger.info("Start Creating clicked - Opening PhotoSourceSheet");
    setIsSheetOpen(true);
  };
  
  const handleChooseFromPhone = () => {
    setIsSheetOpen(false);
    setShowCloudinaryUploader(true);
  };

  const handleImportFromGooglePhotos = () => {
    toast.info("Import from Google Photos is coming soon!");
  };

  return (
    <>
      {showProgressScreen && (
        <UploadProgressScreen 
          progress={uploadProgress}
          currentFile={currentUploadFile}
          totalFiles={totalUploadFiles}
        />
      )}
      
      {!showProgressScreen && !showCloudinaryUploader && (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] px-4 py-8">
          <Button 
            onClick={handleStartCreatingClick}
            disabled={isUploading}
            variant="outline" 
            className="relative bg-white rounded-full w-24 h-24 md:w-40 md:h-40 shadow-lg hover:shadow-xl transition-shadow duration-300 ease-in-out flex items-center justify-center group"
          >
            <Plus className="text-[#F76C5E] w-10 h-10 md:w-16 md:h-16 transition-transform duration-300 ease-in-out group-hover:scale-110" />
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

      {showCloudinaryUploader && !showProgressScreen && (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] px-4 py-8">
          <div className="w-full max-w-2xl">
            <h2 className="text-2xl font-semibold text-center mb-6">Upload Your Photos</h2>
            <CloudinaryUploader
              onUploadComplete={handleUploadComplete}
              onUploadStart={handleUploadStart}
              onUploadProgress={handleUploadProgress}
              multiple={true}
              maxFiles={20}
            />
            <Button
              variant="ghost"
              onClick={() => setShowCloudinaryUploader(false)}
              className="mt-4 mx-auto block"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}