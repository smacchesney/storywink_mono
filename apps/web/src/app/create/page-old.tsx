"use client";

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import PhotoSourceSheet from '@/components/create/PhotoSourceSheet';
import UploadProgressScreen from '@/components/create/UploadProgressScreen';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@clerk/nextjs';


// --- Type Definitions --- 
type Asset = {
  id: string;
  thumbnailUrl: string;
};

// Main Page Component
export default function CreateBookPage() {
  const router = useRouter();
  const { getToken, isLoaded } = useAuth();
  const [uploadedAssets, setUploadedAssets] = useState<Asset[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  
  // State for Progress Screen
  const [showProgressScreen, setShowProgressScreen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentUploadFile, setCurrentUploadFile] = useState(0);
  const [totalUploadFiles, setTotalUploadFiles] = useState(0);

  // Updated function to use the API client
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
      console.error('Book Creation API Call Failed:', error);
      toast.error(`Failed to start book creation: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  };

  const handleUploadComplete = async (newAssets: Asset[]) => {
    const allAssets = [...uploadedAssets, ...newAssets];
    setUploadedAssets(allAssets);
    console.log("Upload complete, total assets:", allAssets);

    // Don't hide progress screen yet
    // setUploadProgress(0); // Keep progress at 100% visually
    // setCurrentUploadFile(totalUploadFiles); 
    // setTotalUploadFiles(0);
    // setShowProgressScreen(false); // <-- REMOVE THIS HIDE CALL

    if (allAssets.length > 0) {
      const assetIds = allAssets.map(asset => asset.id);
      const creationResult = await handleCreateBook(assetIds);
      
      if (creationResult?.bookId) {
        // Navigation will unmount this component, hiding the progress screen
        router.push(`/create/${creationResult.bookId}/edit`); 
      } else {
        // Error occurred during handleCreateBook (already toasted there)
        setShowProgressScreen(false); // <-- Hide progress ONLY on failure
        setIsUploading(false); 
      }
    } else {
      toast.warning("No assets uploaded, cannot create book.");
      setShowProgressScreen(false); // <-- Hide progress if no assets
      setIsUploading(false); 
    }
    // setIsUploading is set to false inside handleFileInputChange finally block or on creation failure
  };

  // Upload logic (calls API)
  const handleFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
     if (event.target.files && event.target.files.length > 0) {
       const files = Array.from(event.target.files);
       
       // Reset state for new upload batch
       setIsUploading(true);
       setShowProgressScreen(true);
       setUploadProgress(0);
       setCurrentUploadFile(1); // Start with file 1
       setTotalUploadFiles(files.length);
       
       // Simulate Progress (replace with actual progress later)
       // TODO: Implement real progress tracking (e.g., using XHR events or a library)
       let simulatedProgress = 0;
       const progressInterval = setInterval(() => {
         simulatedProgress += 10;
         if (simulatedProgress <= 100) {
           setUploadProgress(simulatedProgress);
           // Simple simulation of file count increment
           setCurrentUploadFile(Math.min(totalUploadFiles, Math.ceil(simulatedProgress / (100 / totalUploadFiles)))); 
         } else {
           clearInterval(progressInterval);
         }
       }, 200); // Update progress every 200ms
       
       const formData = new FormData();
       files.forEach((file) => formData.append('files', file));
       
       try {
          const token = await getToken();
          if (!token) {
            throw new Error('Not authenticated');
          }

          // Upload files using API client
          const uploadedAssets = [];
          
          // Upload files one by one using the API client
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const response = await apiClient.uploadFile(file, token);
            
            if (!response.success || !response.data) {
              throw new Error(response.error || `Failed to upload ${file.name}`);
            }
            
            uploadedAssets.push(response.data as Asset);
            
            // Update progress for each file
            setCurrentUploadFile(i + 1);
            setUploadProgress(Math.round(((i + 1) / files.length) * 100));
          }
          
          clearInterval(progressInterval); // Stop simulation on fetch completion
          setUploadProgress(100); // Ensure progress hits 100%
          setCurrentUploadFile(totalUploadFiles); // Ensure final file count is shown

          if (uploadedAssets.length > 0) {
              // Call completion handler which will then trigger book creation
              handleUploadComplete(uploadedAssets);
          } else {
              setShowProgressScreen(false); // Hide progress if no assets
              toast.warning("Upload completed, but no assets were returned.");
          }
       } catch (error) {
          clearInterval(progressInterval); // Stop simulation on error
          setShowProgressScreen(false); // Hide progress on error
          console.error("File Upload Error:", error);
          toast.error(`Error uploading files: ${error instanceof Error ? error.message : 'Unknown error'}`);
       } finally {
          // Do not hide progress screen here, handleUploadComplete does it
          setIsUploading(false); // Allow new uploads
          if (fileInputRef.current) fileInputRef.current.value = '';
       }
     }
   };

  const triggerUpload = () => fileInputRef.current?.click();

  // Modified handler to open the sheet
  const handleStartCreatingClick = () => {
    console.log("Start Creating clicked - Opening PhotoSourceSheet");
    setIsSheetOpen(true);
    // triggerUpload();
  };
  
  // Placeholder for Google Photos import
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
      
      {!showProgressScreen && (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] px-4 py-8">
          <input type="file" ref={fileInputRef} onChange={handleFileInputChange} className="hidden" multiple accept="image/jpeg,image/png,image/heic,image/heif" />

          <Button 
            onClick={handleStartCreatingClick}
            disabled={isUploading}
            variant="outline" 
            className="relative bg-white rounded-full w-24 h-24 md:w-40 md:h-40 shadow-lg hover:shadow-xl transition-shadow duration-300 ease-in-out flex items-center justify-center group"
          >
            <Plus className="text-[#F76C5E] w-10 h-10 md:w-16 md:h-16 transition-transform duration-300 ease-in-out group-hover:scale-110" />
            {/* Loader is removed here as the full screen overlay handles loading state */}
          </Button>

          <p className="mt-4 md:mt-6 text-lg md:text-xl text-gray-600 font-medium">
            Start Creating
          </p>
          
          <PhotoSourceSheet
            isOpen={isSheetOpen}
            onOpenChange={setIsSheetOpen}
            onChooseFromPhone={triggerUpload}
            onImportFromGooglePhotos={handleImportFromGooglePhotos}
          />
        </div>
      )}
    </>
  );
}