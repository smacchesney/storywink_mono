"use client";

import React, { useRef, useEffect } from 'react';
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
  const pollCountRef = useRef(0);
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
          pollCountRef.current += 1;
          if (pollCountRef.current > MAX_POLLS / 2) { // Stop if errors persist
            throw new Error("Failed to get book status repeatedly.");
          }
          return; // Continue polling for a while
        }

        const data = await response.json();
        const status = data.status as BookStatus;
        pollCountRef.current += 1;

        if (status === BookStatus.STORY_READY || status === BookStatus.ILLUSTRATING || status === BookStatus.COMPLETED) {
          clearInterval(intervalId);
          onComplete(bookId);
        } else if (status === BookStatus.FAILED) {
          clearInterval(intervalId);
          onError(bookId, "Generation process failed.");
        } else if (pollCountRef.current >= MAX_POLLS) {
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

  }, [bookId, onComplete, onError]);

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
      <div className="isolate mb-4">
        <TextShimmerWave
          className="text-xl md:text-2xl font-semibold font-playful [--base-color:#374151] [--base-gradient-color:#F76C5E] dark:[--base-color:#D1D5DB] dark:[--base-gradient-color:#F76C5E]"
          duration={1}
          spread={1}
          zDistance={1}
          scaleDistance={1.1}
          rotateYDistance={20}
        >
          Brewing a Bedtime adventure...
        </TextShimmerWave>
      </div>

      {/* Time estimate and instruction */}
      <div className="max-w-xs md:max-w-sm space-y-2">
        <p className="text-sm md:text-base text-gray-600">
          This usually takes <span className="font-medium text-gray-700">1-2 minutes</span>.
        </p>
        <p className="text-xs md:text-sm text-gray-500">
          Please don&apos;t close this page while your story is being written.
        </p>
      </div>
    </div>
  );
}

export default WritingProgressScreen; 