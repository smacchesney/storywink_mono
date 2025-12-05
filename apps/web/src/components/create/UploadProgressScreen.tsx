"use client";

import React from 'react';
import Image from 'next/image';
// import { Loader2 } from 'lucide-react'; // Or a custom doodle SVG
// import { TextShimmer } from '@/components/ui/text-shimmer'; // Old import
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave'; // New import

interface UploadProgressScreenProps {
  progress?: number;
  currentFile?: number;
  totalFiles?: number;
  message?: string; // Allow custom message
}

export function UploadProgressScreen({
  progress,
  currentFile,
  totalFiles,
  message = "Uploading your photos...",
}: UploadProgressScreenProps) {
  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50">
      {/* Kai the Dino Mascot - Isolated from shimmer effects */}
      <div className="mb-8 transform-none">
        <Image
          src="/images/mascot/kai the dino uploading.png"
          alt="Kai the Dino uploading files"
          width={200}
          height={200}
          className="w-20 h-20 md:w-28 md:h-28 object-contain"
          priority
        />
      </div>

      {/* Text with Shimmer Effect - Properly contained */}
      <div className="isolate">
        <TextShimmerWave
          className="text-lg md:text-xl font-excalifont [--base-color:#374151] [--base-gradient-color:#F76C5E] dark:[--base-color:#D1D5DB] dark:[--base-gradient-color:#F76C5E]"
          duration={1}
          spread={1}
          zDistance={1}
          scaleDistance={1.1}
          rotateYDistance={20}       
        >
          {message}
        </TextShimmerWave>
      </div>

      {/* Optional progress indicator */}
      {progress !== undefined && totalFiles !== undefined && (
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600 mb-2">
            {currentFile ? `Uploading photo ${currentFile} of ${totalFiles}` : `Processing ${totalFiles} photo${totalFiles > 1 ? 's' : ''}...`}
          </p>
          <div className="w-64 bg-gray-200 rounded-full h-2">
            <div 
              className="bg-[#F76C5E] h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default UploadProgressScreen; 