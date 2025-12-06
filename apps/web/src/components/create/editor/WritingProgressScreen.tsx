"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
// import { Loader2 } from 'lucide-react'; // Or a custom doodle SVG
// import { TextShimmer } from '@/components/ui/text-shimmer'; // Old import
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave'; // New import
// import { toast } from 'sonner'; // Removed - progress already shown in UI
import { BookStatus } from '@prisma/client';

interface WritingProgressScreenProps {
  bookId: string;
  onComplete: (bookId: string) => void;
  onError: (bookId: string, errorMsg?: string) => void;
}

const POLLING_INTERVAL = 5000; // Check status every 5 seconds

export function WritingProgressScreen({
  bookId,
  onComplete,
  onError,
}: WritingProgressScreenProps) {
  const [pollCount, setPollCount] = useState(0);
  const MAX_POLLS = 24; // Timeout after 2 minutes (24 * 5 seconds)

  useEffect(() => {
    if (!bookId) return;

    const intervalId = setInterval(async () => {
      try {
        const response = await fetch(`/api/book-status?bookId=${bookId}`);
        if (!response.ok) {
          // Handle non-OK responses during polling
          console.error(`Polling error: ${response.status}`);
          // Optionally stop polling after several errors
          if (pollCount > MAX_POLLS / 2) { // Stop if errors persist
              throw new Error("Failed to get book status repeatedly.");
          }
          setPollCount(prev => prev + 1);
          return; // Continue polling for a while
        }
        
        const data = await response.json();
        const status = data.status as BookStatus;
        setPollCount(prev => prev + 1);

        if (status === BookStatus.STORY_READY || status === BookStatus.ILLUSTRATING || status === BookStatus.COMPLETED) {
          clearInterval(intervalId);
          onComplete(bookId);
        } else if (status === BookStatus.FAILED) {
          clearInterval(intervalId);
          onError(bookId, "Generation process failed.");
        } else if (pollCount >= MAX_POLLS) {
            clearInterval(intervalId);
            onError(bookId, "Generation timed out.");
        }
        // Continue polling if still GENERATING
      } catch (err) {
        console.error("Error polling book status:", err);
        clearInterval(intervalId);
        const message = err instanceof Error ? err.message : "Could not check status."
        onError(bookId, message);
      }
    }, POLLING_INTERVAL);

    // Cleanup function to clear interval when component unmounts
    return () => clearInterval(intervalId);

  }, [bookId, onComplete, onError, pollCount]); // pollCount is a dependency

  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50">
      {/* Kai the Dino Writing Mascot - No effects */}
      <div className="mb-8 transform-none">
        <Image
          src="/images/mascot/kai the dino writing.png"
          alt="Kai the Dino writing a story"
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
          Brewing a Bedtime adventure...
        </TextShimmerWave>
      </div>
    </div>
  );
}

export default WritingProgressScreen; 