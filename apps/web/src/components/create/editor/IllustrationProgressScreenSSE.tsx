"use client";

import React, { useEffect } from 'react';
import Image from 'next/image';
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave';
// import { toast } from 'sonner'; // Removed - progress already shown in UI
import { BookStatus } from '@prisma/client';
import { useBookStatusStream } from '@/hooks/useBookStatusStream';
import { Progress } from '@/components/ui/progress';

interface IllustrationProgressScreenSSEProps {
  bookId: string;
  onComplete: (bookId: string, finalStatus: BookStatus) => void;
  onError: (bookId: string, errorMsg?: string) => void;
}

export function IllustrationProgressScreenSSE({
  bookId,
  onComplete,
  onError,
}: IllustrationProgressScreenSSEProps) {
  
  const { progress, error, isConnected } = useBookStatusStream(bookId, {
    onStatusChange: (newStatus) => {
      console.log(`[SSE] Status changed to: ${newStatus}`);
    },
    onProgress: (prog) => {
      console.log(`[SSE] Progress update:`, prog);
    },
    onComplete: (finalStatus) => {
      // Status is already shown in the UI
      onComplete(bookId, finalStatus);
    },
  });

  useEffect(() => {
    if (error) {
      console.error('[SSE] Connection error:', error);
      // Fallback to polling if SSE fails
      onError(bookId, error);
    }
  }, [error, bookId, onError]);

  // Calculate progress percentage
  const progressPercent = progress 
    ? Math.round(((progress.completedPages || 0) / (progress.totalPages || 1)) * 100)
    : 0;

  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50 p-4 text-center">
      {/* Kai the Dino Illustrating Mascot */}
      <div className="mb-8 transform-none">
        <Image
          src="/images/mascot/kai the dino illustrating.png"
          alt="Kai the Dino creating illustrations"
          width={200}
          height={200}
          className="w-20 h-20 md:w-28 md:h-28 object-contain"
          priority
        />
      </div>

      {/* Text with Shimmer Effect */}
      <div className="isolate mb-6">
        <TextShimmerWave 
          className="text-lg md:text-xl font-medium mb-4 [--base-color:#374151] [--base-gradient-color:#F76C5E] dark:[--base-color:#D1D5DB] dark:[--base-gradient-color:#F76C5E]"
          duration={1}
          spread={1}
          zDistance={1}
          scaleDistance={1.1}
          rotateYDistance={20}
        >
          Creating Your Story 🎨
        </TextShimmerWave>
      </div>

      {/* Progress Bar */}
      {progress && progress.totalPages && progress.totalPages > 0 && (
        <div className="w-full max-w-md mb-4">
          <Progress value={progressPercent} className="h-2" />
          <p className="text-sm text-gray-600 mt-2">
            {progress.completedPages} of {progress.totalPages} illustrations complete
          </p>
        </div>
      )}

      {/* Connection Status */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        {isConnected ? 'Live updates active' : 'Reconnecting...'}
      </div>

      <p className="text-sm text-gray-500 mt-4">
        Feel free to navigate away, and check back "My Library" later
      </p>
    </div>
  );
}

export default IllustrationProgressScreenSSE;