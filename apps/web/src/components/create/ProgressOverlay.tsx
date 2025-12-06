"use client";

import React from 'react';
import Image from 'next/image';
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave';
import { useUploadFlow } from '@/context/UploadFlowContext';

const mascotImages: Record<string, string> = {
  processing: '/images/mascot/kai the dino uploading.png',
  preparing: '/images/mascot/kai the dino uploading.png',
  loading: '/images/mascot/kai the dino uploading.png',
};

export function ProgressOverlay() {
  const { state } = useUploadFlow();

  if (state.phase === 'idle') {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50">
      {/* Kai the Dino Mascot - Isolated from shimmer effects */}
      <div className="mb-8 transform-none">
        <Image
          src={mascotImages[state.phase] || mascotImages.processing}
          alt="Kai the Dino"
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
          {state.message}
        </TextShimmerWave>
      </div>

      {/* Optional progress bar for processing phase */}
      {state.phase === 'processing' && state.progress !== undefined && state.totalFiles !== undefined && (
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600 mb-2">
            {state.currentFile
              ? `Processing photo ${state.currentFile} of ${state.totalFiles}`
              : `Processing ${state.totalFiles} photo${state.totalFiles > 1 ? 's' : ''}...`}
          </p>
          <div className="w-64 bg-gray-200 rounded-full h-2">
            <div
              className="bg-[#F76C5E] h-2 rounded-full transition-all duration-300"
              style={{ width: `${state.progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default ProgressOverlay;
