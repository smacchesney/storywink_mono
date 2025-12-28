"use client";

import React, { useRef, useEffect, useState } from 'react';
import Image from 'next/image';
import { TextShimmerWave } from '@/components/ui/text-shimmer-wave';
import { BookStatus } from '@prisma/client';

interface WritingProgressScreenProps {
  bookId: string;
  onComplete: (bookId: string) => void;
  onError: (bookId: string, errorMsg?: string) => void;
}

const POLLING_INTERVAL = 5000; // Check status every 5 seconds

// Whimsical rotating messages
const STORY_MESSAGES = [
  "Sprinkling in some adventure...",
  "Adding a dash of magic...",
  "Mixing in giggles and wonder...",
  "Weaving in cozy moments...",
  "Stirring up a happy ending...",
];

// Sparkle component for floating elements
const Sparkle = ({
  size,
  top,
  left,
  delay,
  duration
}: {
  size: number;
  top: string;
  left: string;
  delay: number;
  duration: number;
}) => (
  <div
    className="absolute pointer-events-none"
    style={{
      top,
      left,
      width: size,
      height: size,
      opacity: 0.12,
      animation: `sparkle-drift ${duration}s ease-in-out ${delay}s infinite`,
    }}
  >
    <svg viewBox="0 0 24 24" fill="#F76C5E" className="w-full h-full">
      <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7L12 17l-6.3 4 2.3-7-6-4.6h7.6L12 2z" />
    </svg>
  </div>
);

// Progress dots component
const ProgressDots = () => (
  <div className="flex gap-1.5 mt-4">
    {[0, 1, 2].map((i) => (
      <div
        key={i}
        className="w-1.5 h-1.5 rounded-full bg-coral-primary"
        style={{
          opacity: 0.4,
          animation: `pulse-dot 1.4s ease-in-out ${i * 0.2}s infinite`,
        }}
      />
    ))}
  </div>
);

export function WritingProgressScreen({
  bookId,
  onComplete,
  onError,
}: WritingProgressScreenProps) {
  const pollCountRef = useRef(0);
  const MAX_POLLS = 24; // Timeout after 2 minutes (24 * 5 seconds)
  const [messageIndex, setMessageIndex] = useState(0);

  // Rotate through story messages
  useEffect(() => {
    const messageInterval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % STORY_MESSAGES.length);
    }, 4000);

    return () => clearInterval(messageInterval);
  }, []);

  // Poll for book status
  useEffect(() => {
    if (!bookId) return;

    const intervalId = setInterval(async () => {
      try {
        const response = await fetch(`/api/book-status?bookId=${bookId}`);
        if (!response.ok) {
          console.error(`Polling error: ${response.status}`);
          pollCountRef.current += 1;
          if (pollCountRef.current > MAX_POLLS / 2) {
            throw new Error("Failed to get book status repeatedly.");
          }
          return;
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
      } catch (err) {
        console.error("Error polling book status:", err);
        clearInterval(intervalId);
        const message = err instanceof Error ? err.message : "Could not check status."
        onError(bookId, message);
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [bookId, onComplete, onError]);

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center z-50 overflow-hidden"
      style={{
        background: 'radial-gradient(ellipse at 50% 30%, #FFF9F5 0%, #FFFBF5 50%, #FFF5F0 100%)',
      }}
    >
      {/* CSS Keyframes */}
      <style jsx>{`
        @keyframes sparkle-drift {
          0%, 100% {
            transform: translateY(0) rotate(0deg);
            opacity: 0.08;
          }
          50% {
            transform: translateY(-12px) rotate(15deg);
            opacity: 0.15;
          }
        }

        @keyframes float {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-6px);
          }
        }

        @keyframes pulse-dot {
          0%, 100% {
            opacity: 0.3;
            transform: scale(1);
          }
          50% {
            opacity: 0.8;
            transform: scale(1.2);
          }
        }

        @keyframes fade-message {
          0%, 100% {
            opacity: 0;
            transform: translateY(4px);
          }
          10%, 90% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          @keyframes sparkle-drift {
            0%, 100% { transform: none; opacity: 0.1; }
          }
          @keyframes float {
            0%, 100% { transform: none; }
          }
          @keyframes pulse-dot {
            0%, 100% { opacity: 0.5; transform: none; }
          }
        }
      `}</style>

      {/* Subtle floating sparkles */}
      <Sparkle size={16} top="12%" left="8%" delay={0} duration={25} />
      <Sparkle size={12} top="18%" left="85%" delay={3} duration={28} />
      <Sparkle size={14} top="72%" left="12%" delay={6} duration={22} />
      <Sparkle size={10} top="65%" left="88%" delay={9} duration={30} />
      <Sparkle size={13} top="85%" left="25%" delay={4} duration={26} />

      {/* Kai the Dino Writing Mascot with float animation */}
      <div
        className="mb-10"
        style={{
          animation: 'float 3s ease-in-out infinite',
          filter: 'drop-shadow(0 8px 16px rgba(247, 108, 94, 0.15))',
        }}
      >
        <Image
          src="/images/mascot/kai the dino writing.png"
          alt="Kai the Dino writing a story"
          width={200}
          height={200}
          className="w-28 h-28 md:w-36 md:h-36 object-contain"
          priority
        />
      </div>

      {/* Main text with shimmer effect */}
      <div className="isolate mb-6">
        <TextShimmerWave
          className="text-2xl md:text-3xl font-semibold font-playful [--base-color:#374151] [--base-gradient-color:#F76C5E]"
          duration={1.2}
          spread={1}
          zDistance={1}
          scaleDistance={1.05}
          rotateYDistance={15}
        >
          Brewing a Bedtime adventure...
        </TextShimmerWave>
      </div>

      {/* Rotating story ingredient message */}
      <div className="h-8 flex items-center justify-center mb-2">
        <p
          key={messageIndex}
          className="text-sm md:text-base text-gray-500 font-medium text-center"
          style={{
            animation: 'fade-message 4s ease-in-out',
          }}
        >
          {STORY_MESSAGES[messageIndex]}
        </p>
      </div>

      {/* Progress dots */}
      <ProgressDots />

      {/* Keep page open notice */}
      <p className="text-xs text-gray-400 mt-8 text-center max-w-xs">
        Please don&apos;t close this page while your story is being written.
      </p>
    </div>
  );
}

export default WritingProgressScreen;
