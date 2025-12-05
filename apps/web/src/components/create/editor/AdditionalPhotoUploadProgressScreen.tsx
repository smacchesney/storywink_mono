"use client";

import React from 'react';
import Image from 'next/image';
// import { Loader2 } from 'lucide-react'; // Remove Loader2
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave'; // Import TextShimmerWave

// Remove the empty interface
// interface AdditionalPhotoUploadProgressScreenProps {
//   // This component is simple and doesn't need props for now
//   // It could be extended later if needed (e.g., for custom messages)
// }

// Adjust component definition to not use React.FC with an empty interface
const AdditionalPhotoUploadProgressScreen = () => {
  return (
    // Change background to white, match layout of UploadProgressScreen
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50">
      {/* Kai the Dino Mascot - No effects */}
      <div className="mb-8 transform-none">
        <Image
          src="/images/mascot/kai the dino uploading.png"
          alt="Kai the Dino uploading photos"
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
          Adding your photos...
        </TextShimmerWave>
      </div>
    </div>
  );
};

export default AdditionalPhotoUploadProgressScreen; 