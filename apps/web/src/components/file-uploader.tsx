"use client";

import React, { useState, useRef, useCallback } from 'react';
import { UploadCloud, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils'; // Assuming cn utility exists from shadcn/ui setup

interface FileUploaderProps {
  onFilesSelected: (files: File[]) => void;
  onError?: (error: string) => void; // Callback for validation errors
  className?: string;
  acceptedFileTypes?: string[]; // e.g., ['image/jpeg', 'image/png']
  maxFileSize?: number; // Max size in bytes
  multiple?: boolean; // Allow multiple files? Default true
}

export function FileUploader({ 
  onFilesSelected, 
  onError,
  className,
  acceptedFileTypes = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'], // Default image types
  maxFileSize = 10 * 1024 * 1024, // Default 10MB
  multiple = true,
 }: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null); // State for validation errors
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFiles = useCallback((files: File[]): File[] => {
    const validFiles: File[] = [];
    const errors: string[] = [];

    files.forEach(file => {
      // Type validation
      if (acceptedFileTypes && !acceptedFileTypes.includes(file.type)) {
        errors.push(`File type not supported: ${file.name} (${file.type})`);
        return; // Skip this file
      }
      // Size validation
      if (maxFileSize && file.size > maxFileSize) {
         errors.push(`File too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB). Max size is ${(maxFileSize / 1024 / 1024).toFixed(0)}MB.`);
         return; // Skip this file
      }
      // If valid, add to the list
      validFiles.push(file);
    });

    if (errors.length > 0) {
      const errorMessage = errors.join('\n');
      setError(errorMessage);
      if (onError) {
        onError(errorMessage);
      }
       // Return only valid files, even if there were errors with others
      return validFiles; 
    } else {
      setError(null); // Clear previous errors if all files are valid
      return validFiles;
    }
  }, [acceptedFileTypes, maxFileSize, onError]); // Added dependencies

  // Update handlers to use validateFiles
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null); // Clear error on new selection attempt
    if (event.target.files) {
      const filesArray = Array.from(event.target.files);
      const validFiles = validateFiles(filesArray);
      if (validFiles.length > 0) {
         onFilesSelected(validFiles);
      }
      event.target.value = ''; 
    }
  };

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    setError(null); // Clear error on new drop

    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      const filesArray = Array.from(event.dataTransfer.files);
       const validFiles = validateFiles(filesArray);
        if (validFiles.length > 0) {
           onFilesSelected(validFiles);
        }
      event.dataTransfer.clearData(); 
    }
  }, [onFilesSelected, validateFiles]); // Added validateFiles dependency

  // Handler for clicking the drop zone to trigger file input
  const handleAreaClick = () => {
    fileInputRef.current?.click();
  };

  // Handlers for drag-and-drop events
  const handleDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // Check relatedTarget to prevent flickering when dragging over child elements
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
        setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault(); // Necessary to allow drop
    event.stopPropagation();
    setIsDragging(true); // Keep highlighting
  }, []);

  return (
    <div
      className={cn(
        "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors duration-200 ease-in-out",
        error ? "border-destructive bg-destructive/10" // Error state style
              : isDragging ? "border-primary bg-primary/10" 
                           : "border-muted-foreground/50 hover:border-primary hover:bg-primary/5 bg-background",
        className
      )}
      onClick={handleAreaClick}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role="button"
      aria-label="File upload area"
      tabIndex={0} // Make it focusable
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleAreaClick(); }} // Allow activation with keyboard
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden" // Hide the default input
        multiple={multiple} // Allow multiple files by default, can be controlled via props later
        accept={acceptedFileTypes ? acceptedFileTypes.join(',') : undefined} // Set accept attribute
      />
      <div className="flex flex-col items-center justify-center space-y-4 pointer-events-none"> {/* Prevent pointer events on children during drag */}
        {error ? (
          <>
            <AlertCircle className="h-12 w-12 text-destructive" />
             {/* Displaying error message - might need refinement for multiple lines */}
            <p className="text-destructive text-sm whitespace-pre-line">{error}</p> 
            <p className="text-muted-foreground text-xs">Please try again.</p>
          </>
        ) : (
          <>
            <UploadCloud className={cn("h-12 w-12 text-muted-foreground", isDragging && "text-primary")} />
            <p className="text-muted-foreground">
              Drag & drop photos here, or{" "}
              <span className="font-semibold text-primary">click to browse</span>
            </p>
            <p className="text-xs text-muted-foreground">
               Supports: {acceptedFileTypes.map(t => t.split('/')[1].toUpperCase()).join(', ')}. Max { (maxFileSize / 1024 / 1024).toFixed(0) }MB.
             </p>
          </>
        )}
      </div>
    </div>
  );
} 