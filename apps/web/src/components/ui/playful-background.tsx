"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { CLOUD, CLOUD_VIEWBOX, STAR5 } from "@/components/ui/storydust";

interface PlayfulBackgroundProps {
  /** `landing` gets corner clouds + margin doodles; `auth` is a calmer wash. */
  variant?: "landing" | "auth" | "minimal";
  className?: string;
}

/** A soft, low-opacity cloud silhouette. */
function Cloud({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox={CLOUD_VIEWBOX}
      className={className}
      style={style}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={CLOUD} />
    </svg>
  );
}

/** A single hand-drawn star doodle (the app's one canonical star). */
function Star({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} fill="currentColor" aria-hidden="true">
      <path d={STAR5} />
    </svg>
  );
}

/**
 * PlayfulBackground — an intentional storybook backdrop.
 *
 * A very soft vertical wash (cream drifting into the faintest peach/sky),
 * two large cloud silhouettes anchored to the hero corners, and a small,
 * deterministic set of doodles that live only in the side margins so they
 * never sit behind reading copy. Fixed to the viewport, purely decorative.
 */
const PlayfulBackground: React.FC<PlayfulBackgroundProps> = ({
  variant = "landing",
  className,
}) => {
  const showClouds = variant !== "minimal";
  const showDoodles = variant === "landing";

  return (
    <div
      className={cn("fixed inset-0 -z-0 overflow-hidden pointer-events-none", className)}
      aria-hidden="true"
    >
      {/* Vertical wash: cream at top, the faintest peach + sky settling below */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, #FFFBF5 0%, #FFF7EF 45%, #FDF2EA 78%, #F4F6F7 100%)",
        }}
      />
      {/* A soft peach glow behind the hero, and a whisper of sky lower down */}
      <div
        className="absolute inset-x-0 top-0 h-[70vh]"
        style={{
          background:
            "radial-gradient(60% 55% at 50% 18%, rgba(255,218,179,0.30) 0%, rgba(255,218,179,0) 70%)",
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-[55vh]"
        style={{
          background:
            "radial-gradient(70% 60% at 50% 100%, rgba(168,213,229,0.16) 0%, rgba(168,213,229,0) 70%)",
        }}
      />

      {showClouds && (
        <>
          {/* Large cloud anchored to the top-left, drifting gently */}
          <Cloud
            className="absolute text-white/70 cloud-drift-slow w-56 sm:w-72 md:w-96"
            style={{ top: "6%", left: "-6%" }}
          />
          {/* Large cloud anchored to the top-right, drifting the other way */}
          <Cloud
            className="absolute text-white/60 cloud-drift-slower w-48 sm:w-64 md:w-80"
            style={{ top: "2%", right: "-5%" }}
          />
          {/* A lower, smaller cloud on the left to balance the composition */}
          <Cloud
            className="absolute text-white/50 cloud-drift-slow hidden md:block w-72"
            style={{ top: "52%", left: "-8%" }}
          />
        </>
      )}

      {showDoodles && (
        <>
          {/* Deterministic doodles — side gutters only, never behind center copy */}
          <Star className="absolute text-coral/15 w-4 h-4" style={{ top: "14%", left: "4%", transform: "rotate(-12deg)" }} />
          <Star className="absolute text-coral/10 w-3 h-3 hidden sm:block" style={{ top: "30%", left: "6%", transform: "rotate(18deg)" }} />
          <Star className="absolute text-mint/40 w-5 h-5 hidden md:block" style={{ top: "62%", left: "3%", transform: "rotate(8deg)" }} />
          <Star className="absolute text-coral/12 w-4 h-4" style={{ top: "20%", right: "5%", transform: "rotate(14deg)" }} />
          <Star className="absolute text-sky/40 w-4 h-4 hidden sm:block" style={{ top: "46%", right: "4%", transform: "rotate(-20deg)" }} />
          <Star className="absolute text-coral/10 w-3 h-3 hidden md:block" style={{ top: "72%", right: "6%", transform: "rotate(30deg)" }} />
        </>
      )}
    </div>
  );
};

export default PlayfulBackground;
