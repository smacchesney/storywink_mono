"use client";

import React from 'react';
import Image from 'next/image';
// import { Loader2 } from 'lucide-react'; // Or a custom doodle SVG
// import { TextShimmer } from '@/components/ui/text-shimmer'; // Old import
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave'; // New import

interface UploadProgressScreenProps {
  progress?: number; // Optional now since we're not showing progress
  currentFile?: number; // Made optional
  totalFiles?: number; // Made optional
}

export function UploadProgressScreen({
  progress: _progress,
  currentFile: _currentFile,
  totalFiles: _totalFiles,
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
          className="text-lg md:text-xl font-medium [--base-color:#374151] [--base-gradient-color:#F76C5E] dark:[--base-color:#D1D5DB] dark:[--base-gradient-color:#F76C5E]"
          duration={1}
          spread={1}
          zDistance={1}
          scaleDistance={1.1}
          rotateYDistance={20}       
        >
          Hatching a story egg...
        </TextShimmerWave>
      </div>
    </div>
  );
}

export default UploadProgressScreen; 