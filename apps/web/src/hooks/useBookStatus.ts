"use client";

import { useEffect, useRef, useState, useCallback } from 'react';
import { BookStatus } from '@prisma/client';

/**
 * The single source of truth for polling a book's generation status.
 *
 * Replaces the copy-pasted polling loops that lived in the library view,
 * preview page, review page and progress screen. Hits GET /api/book-status,
 * which returns the counts the create flow needs to describe progress
 * ("Illustrating page 3 of 8"), and stops on its own once the book reaches a
 * terminal state.
 */

export interface BookStatusData {
  status: BookStatus | null;
  /** Worker-written pipeline phase (finer than status); null falls back to status-only copy. */
  generationPhase: string | null;
  bookType: string | null;
  /** The child the book is for — lets the wait screen use their name. */
  childName: string | null;
  totalPages: number;
  pagesWithText: number;
  pagesWithIllustrations: number;
  failedPages: number;
  error: string | null;
  isTimedOut: boolean;
}

export interface BookStatusResult extends BookStatusData {
  /**
   * Clears the last observed status and resumes polling. This is the
   * recovery primitive behind "Try again" on a FAILED book: the retry
   * endpoint flips the book back into a working state server-side, and
   * restart() lets the hook pick that up instead of staying parked on the
   * terminal status it already saw.
   */
  restart: () => void;
}

interface UseBookStatusOptions {
  /** Poll cadence in ms. Defaults to 5000. */
  intervalMs?: number;
  /**
   * Stall window in ms. The hook flips `isTimedOut` only after this long
   * with NO observed change to the status snapshot (status + page counts) —
   * a healthy long run keeps resetting the clock, while a genuinely wedged
   * book still gets the gentle exit. The caller decides how gentle.
   */
  timeoutMs?: number;
  /** Pass false to hold polling (e.g. before a bookId is known). */
  enabled?: boolean;
}

// Statuses at which polling can stop for good. STORY_READY is deliberately
// NOT here: in the auto-illustrate flow it's a transient step on the way to
// ILLUSTRATING, so we keep polling. Callers that stop at STORY_READY (the
// review-first path) navigate away, which unmounts the hook.
const TERMINAL_STATUSES: BookStatus[] = [
  BookStatus.COMPLETED,
  BookStatus.PARTIAL,
  BookStatus.FAILED,
];

/**
 * Polls book status on an interval. Starts when a bookId is present and
 * `enabled`, stops cleanly on unmount, on a terminal status, and after a
 * progress stall longer than `timeoutMs`.
 */
export function useBookStatus(
  bookId: string | null | undefined,
  { intervalMs = 5000, timeoutMs, enabled = true }: UseBookStatusOptions = {}
): BookStatusResult {
  const [data, setData] = useState<BookStatusData>({
    status: null,
    generationPhase: null,
    bookType: null,
    childName: null,
    totalPages: 0,
    pagesWithText: 0,
    pagesWithIllustrations: 0,
    failedPages: 0,
    error: null,
    isTimedOut: false,
  });
  // Bumping the epoch re-runs the polling effect from scratch — see restart().
  const [pollEpoch, setPollEpoch] = useState(0);

  const isMountedRef = useRef(true);
  // Last observed status snapshot and when it last changed. Fetch errors
  // deliberately do NOT touch these: a dead API converges to the gentle
  // timeout the same way a wedged book does.
  const snapshotRef = useRef<string | null>(null);
  const lastChangeAtRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchStatus = useCallback(async (): Promise<BookStatus | null> => {
    if (!bookId) return null;
    try {
      const res = await fetch(`/api/book-status?bookId=${bookId}`);
      if (!isMountedRef.current) return null;
      if (!res.ok) {
        setData((prev) => ({ ...prev, error: `Status ${res.status}` }));
        return null;
      }
      const json = await res.json();
      if (!isMountedRef.current) return null;
      const status = json.status as BookStatus;
      // The phase is part of the snapshot: a QC-fail story regeneration
      // writes 'story' again mid-stage, which resets the stall clock even
      // though no page counts moved.
      const snapshot = [
        status,
        json.generationPhase ?? '',
        json.totalPages ?? 0,
        json.pagesWithText ?? 0,
        json.pagesWithIllustrations ?? 0,
        json.failedPages ?? 0,
      ].join('|');
      if (snapshot !== snapshotRef.current) {
        snapshotRef.current = snapshot;
        lastChangeAtRef.current = Date.now();
      }
      setData((prev) => ({
        ...prev,
        status,
        generationPhase: json.generationPhase ?? null,
        bookType: json.bookType ?? null,
        childName: json.childName ?? null,
        totalPages: json.totalPages ?? 0,
        pagesWithText: json.pagesWithText ?? 0,
        pagesWithIllustrations: json.pagesWithIllustrations ?? 0,
        failedPages: json.failedPages ?? 0,
        error: null,
      }));
      return status;
    } catch (err) {
      if (!isMountedRef.current) return null;
      setData((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Could not check status.',
      }));
      return null;
    }
  }, [bookId]);

  const restart = useCallback(() => {
    setData((prev) => ({ ...prev, status: null, isTimedOut: false }));
    setPollEpoch((e) => e + 1);
  }, []);

  useEffect(() => {
    if (!bookId || !enabled) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    snapshotRef.current = null;
    lastChangeAtRef.current = Date.now();

    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    // Fetch once immediately so the UI reflects state without an interval delay.
    fetchStatus().then((status) => {
      if (status && TERMINAL_STATUSES.includes(status)) stop();
    });

    intervalId = setInterval(async () => {
      if (!isMountedRef.current) return;

      if (timeoutMs != null && Date.now() - lastChangeAtRef.current >= timeoutMs) {
        stop();
        setData((prev) => ({ ...prev, isTimedOut: true }));
        return;
      }

      const status = await fetchStatus();
      // A terminal status will not change — stop churning the interval.
      if (status && TERMINAL_STATUSES.includes(status)) stop();
    }, intervalMs);

    return stop;
  }, [bookId, enabled, intervalMs, timeoutMs, fetchStatus, pollEpoch]);

  return { ...data, restart };
}

export default useBookStatus;
