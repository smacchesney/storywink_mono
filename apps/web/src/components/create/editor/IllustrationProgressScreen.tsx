"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
// import { Loader2 } from 'lucide-react';
// import { TextShimmer } from '@/components/ui/text-shimmer'; // Old import
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave'; // New import
// import { toast } from 'sonner'; // Removed - progress already shown in UI
import { BookStatus } from '@prisma/client';

interface IllustrationProgressScreenProps {
  bookId: string;
  onComplete: (bookId: string, finalStatus: BookStatus) => void;
  onError: (bookId: string, errorMsg?: string) => void;
}

const POLLING_INTERVAL = 5000; // Check status every 5 seconds
const MAX_POLLS = 36; // Timeout after 3 minutes (36 * 5 seconds) for illustration

export function IllustrationProgressScreen({
  bookId,
  onComplete,
  onError,
}: IllustrationProgressScreenProps) {
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    if (!bookId) return;

    const intervalId = setInterval(async () => {
      try {
        const response = await fetch(`/api/book-status?bookId=${bookId}`);
        if (!response.ok) {
          console.error(`Polling error (Illustration): ${response.status}`);
          if (pollCount > MAX_POLLS / 2) {
            throw new Error("Failed to get book status repeatedly during illustration.");
          }
          setPollCount(prev => prev + 1);
          return;
        }
        
        const data = await response.json();
        const status = data.status as BookStatus;
        setPollCount(prev => prev + 1);

        if (status === BookStatus.COMPLETED || status === BookStatus.PARTIAL || status === BookStatus.FAILED) {
          clearInterval(intervalId);
          // PARTIAL means all illustrations done (title pages without text are OK)
          onComplete(bookId, status);
        } else if (pollCount >= MAX_POLLS) {
          clearInterval(intervalId);
          onError(bookId, "Illustration timed out.");
        }
        // Continue polling if still ILLUSTRATING or another intermediate status
      } catch (err) {
        console.error("Error polling illustration status:", err);
        clearInterval(intervalId);
        const message = err instanceof Error ? err.message : "Could not check illustration status."
        onError(bookId, message);
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [bookId, onComplete, onError, pollCount]);

  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50 p-4 text-center">
      {/* Kai the Dino Illustrating Mascot - No effects */}
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

      {/* Text with Shimmer Effect - Properly contained */}
      <div className="isolate">
        <TextShimmerWave 
          className="text-lg md:text-xl font-medium mb-4 [--base-color:#374151] [--base-gradient-color:#F76C5E] dark:[--base-color:#D1D5DB] dark:[--base-gradient-color:#F76C5E]"
          duration={1}
          spread={1}
          zDistance={1}
          scaleDistance={1.1}
          rotateYDistance={20}
        >
          Creating Your Story ✨
        </TextShimmerWave>
      </div>
      <p className="text-sm text-gray-500">
        Feel free to navigate away, and check back "My Library" later
      </p>
    </div>
  );
}

export default IllustrationProgressScreen; 