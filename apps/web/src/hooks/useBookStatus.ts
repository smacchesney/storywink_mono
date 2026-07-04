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
  totalPages: number;
  pagesWithText: number;
  pagesWithIllustrations: number;
  failedPages: number;
  error: string | null;
  isTimedOut: boolean;
}

interface UseBookStatusOptions {
  /** Poll cadence in ms. Defaults to 5000. */
  intervalMs?: number;
  /**
   * When set, the hook stops polling after this many ms and flips
   * `isTimedOut` to true. The caller decides how gentle to make that.
   */
  timeoutMs?: number;
  /** Pass false to hold polling (e.g. before a bookId is known). */
  enabled?: boolean;
}

const TERMINAL_STATUSES: BookStatus[] = [
  BookStatus.COMPLETED,
  BookStatus.PARTIAL,
  BookStatus.FAILED,
  BookStatus.STORY_READY,
];

/**
 * Polls book status on an interval. Starts when a bookId is present and
 * `enabled`, stops cleanly on unmount, on a terminal status, and on timeout.
 */
export function useBookStatus(
  bookId: string | null | undefined,
  { intervalMs = 5000, timeoutMs, enabled = true }: UseBookStatusOptions = {}
): BookStatusData {
  const [data, setData] = useState<BookStatusData>({
    status: null,
    totalPages: 0,
    pagesWithText: 0,
    pagesWithIllustrations: 0,
    failedPages: 0,
    error: null,
    isTimedOut: false,
  });

  const isMountedRef = useRef(true);

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
      setData((prev) => ({
        ...prev,
        status,
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

  useEffect(() => {
    if (!bookId || !enabled) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const startedAt = Date.now();

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

      if (timeoutMs != null && Date.now() - startedAt >= timeoutMs) {
        stop();
        setData((prev) => ({ ...prev, isTimedOut: true }));
        return;
      }

      const status = await fetchStatus();
      // A terminal status will not change — stop churning the interval.
      if (status && TERMINAL_STATUSES.includes(status)) stop();
    }, intervalMs);

    return stop;
  }, [bookId, enabled, intervalMs, timeoutMs, fetchStatus]);

  return data;
}

export default useBookStatus;
