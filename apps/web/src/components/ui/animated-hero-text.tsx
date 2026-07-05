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
 * The slot hugs the CURRENT word and animates its width between words, so
 * the sentence reads naturally ("...your little Hero") with no dead gap —
 * while the animation still never overlaps neighbouring copy. Every word is
 * pre-measured from hidden sizers; widths re-measure on resize because the
 * headline's font size changes across breakpoints.
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
  const sizerRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [widths, setWidths] = useState<number[] | null>(null);

  const words = useMemo(
    () => (rotatingWords.length ? rotatingWords : ["Hero"]),
    [rotatingWords],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Measure every word (hidden sizers share the h1's font styles) and
  // re-measure when the viewport resizes across font-size breakpoints.
  useEffect(() => {
    const measure = () => {
      const next = words.map((_, i) => sizerRefs.current[i]?.offsetWidth ?? 0);
      if (next.every((w) => w > 0)) setWidths(next);
    };
    measure();
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [words, mounted]);

  useEffect(() => {
    if (!mounted) return;
    const id = setTimeout(
      () => setIndex((i) => (i + 1) % words.length),
      interval,
    );
    return () => clearTimeout(id);
  }, [index, words.length, interval, mounted]);

  const current = words[index];
  const currentWidth = widths?.[index];

  return (
    <h1
      className={`text-balance text-3xl font-bold leading-[1.12] tracking-tight text-ink sm:text-4xl md:text-5xl lg:text-[3.4rem] ${className}`}
    >
      {lead ? <span>{lead} </span> : null}
      <motion.span
        className="relative inline-flex justify-center overflow-visible align-baseline font-playful text-coral"
        animate={
          currentWidth !== undefined && !prefersReduced
            ? { width: currentWidth }
            : undefined
        }
        style={
          currentWidth !== undefined && prefersReduced
            ? { width: currentWidth }
            : undefined
        }
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Hidden sizers: one per word, inheriting the exact slot typography */}
        <span aria-hidden className="pointer-events-none absolute left-0 top-0 -z-10 select-none opacity-0">
          {words.map((word, i) => (
            <span
              key={word}
              ref={(el) => {
                sizerRefs.current[i] = el;
              }}
              className="inline-block whitespace-nowrap"
            >
              {word}
            </span>
          ))}
        </span>
        {mounted && !prefersReduced ? (
          <AnimatePresence mode="wait">
            <motion.span
              key={current}
              className="whitespace-nowrap"
              initial={{ opacity: 0, y: "0.32em" }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: "-0.32em" }}
              transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            >
              {current}
            </motion.span>
          </AnimatePresence>
        ) : (
          <span className="whitespace-nowrap">{current}</span>
        )}
      </motion.span>
      {trail ? <span> {trail}</span> : null}
    </h1>
  );
}

export { AnimatedHeroText };
