"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

interface AnimatedHeroTextProps {
  /** Sentence fragment before the rotating word (may be empty). */
  lead?: string;
  /** Sentence fragment after the rotating word (may be empty). */
  trail?: string;
  /** Words that rotate in the coral slot. */
  rotatingWords?: string[];
  /** ms each word stays before the next. */
  interval?: number;
  className?: string;
}

/**
 * Cohesive hero headline with a single inline rotating word.
 *
 * The rotating word lives in a fixed-width inline-block slot sized to the
 * longest word, so the surrounding sentence never reflows and the animation
 * never overlaps neighbouring copy — the two bugs in the previous version.
 */
function AnimatedHeroText({
  lead = "Turn memories into a picturebook starring your little",
  trail = "",
  rotatingWords = ["Hero", "Princess", "Adventurer", "Explorer", "Firefighter"],
  interval = 2600,
  className = "",
}: AnimatedHeroTextProps) {
  const [index, setIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const prefersReduced = useReducedMotion();
  const slotRef = useRef<HTMLSpanElement>(null);
  const [slotWidth, setSlotWidth] = useState<number | undefined>(undefined);

  const words = useMemo(
    () => (rotatingWords.length ? rotatingWords : ["Hero"]),
    [rotatingWords],
  );
  const longest = useMemo(
    () => words.reduce((a, b) => (b.length > a.length ? b : a), ""),
    [words],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Measure the widest word once (via a hidden sizer) so the slot is fixed.
  useEffect(() => {
    if (slotRef.current) {
      setSlotWidth(slotRef.current.getBoundingClientRect().width);
    }
  }, [longest, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const id = setTimeout(
      () => setIndex((i) => (i + 1) % words.length),
      interval,
    );
    return () => clearTimeout(id);
  }, [index, words.length, interval, mounted]);

  const current = words[index];

  return (
    <h1
      className={`text-balance text-3xl font-bold leading-[1.12] tracking-tight text-ink sm:text-4xl md:text-5xl lg:text-[3.4rem] ${className}`}
    >
      {lead ? <span>{lead} </span> : null}
      {/* Fixed-width slot — sized to the longest word, never reflows */}
      <span
        className="relative inline-flex items-center justify-center align-baseline font-playful text-coral"
        style={{ width: slotWidth ? `${slotWidth}px` : undefined }}
      >
        {/* Hidden sizer establishes the slot width for the longest word */}
        <span ref={slotRef} aria-hidden className="invisible whitespace-nowrap">
          {longest}
        </span>
        {mounted && !prefersReduced ? (
          <AnimatePresence mode="wait">
            <motion.span
              key={current}
              className="absolute left-1/2 whitespace-nowrap"
              style={{ x: "-50%" }}
              initial={{ opacity: 0, y: "0.32em" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "-0.32em" }}
              transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            >
              {current}
            </motion.span>
          </AnimatePresence>
        ) : (
          <span
            className="absolute left-1/2 whitespace-nowrap"
            style={{ transform: "translateX(-50%)" }}
          >
            {current}
          </span>
        )}
      </span>
      {trail ? <span> {trail}</span> : null}
    </h1>
  );
}

export { AnimatedHeroText };
