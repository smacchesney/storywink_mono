"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave';
import { Button } from '@/components/ui/button';
import { BookStatus } from '@prisma/client';

interface IllustrationProgressScreenProps {
  bookId: string;
  onComplete: (bookId: string, finalStatus: BookStatus) => void;
  onError: (bookId: string, errorMsg?: string) => void;
}

const POLLING_INTERVAL = 5000; // Check status every 5 seconds
const MAX_POLLS = 180; // Timeout after 15 minutes (180 * 5 seconds) for illustration

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
      {/* Kai the Dino Illustrating Mascot */}
      <div className="mb-6 transform-none">
        <Image
          src="/images/mascot/kai the dino illustrating.png"
          alt="Kai the Dino creating illustrations"
          width={200}
          height={200}
          className="w-24 h-24 md:w-32 md:h-32 object-contain"
          priority
        />
      </div>

      {/* Text with Shimmer Effect */}
      <div className="isolate mb-4">
        <TextShimmerWave
          className="text-xl md:text-2xl font-semibold font-playful [--base-color:#374151] [--base-gradient-color:#F76C5E] dark:[--base-color:#D1D5DB] dark:[--base-gradient-color:#F76C5E]"
          duration={1}
          spread={1}
          zDistance={1}
          scaleDistance={1.1}
          rotateYDistance={20}
        >
          Kai is illustrating your book!
        </TextShimmerWave>
      </div>

      {/* Time estimate and notification info */}
      <div className="max-w-xs md:max-w-sm space-y-3 mb-6">
        <p className="text-sm md:text-base text-gray-600">
          This usually takes <span className="font-medium text-gray-700">10-15 minutes</span>.
        </p>
        <p className="text-sm text-gray-500 flex items-center justify-center gap-1.5">
          We&apos;ll ping you via the
          <Bell className="inline h-4 w-4 text-gray-500" />
          when it&apos;s ready!
        </p>
      </div>

      {/* CTA Button */}
      <Button asChild variant="secondary" size="lg" className="font-medium">
        <Link href="/library">
          Go to My Library
        </Link>
      </Button>
    </div>
  );
}

export default IllustrationProgressScreen; 