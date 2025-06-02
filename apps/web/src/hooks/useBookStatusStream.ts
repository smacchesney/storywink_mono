import { useEffect, useRef, useState, useCallback } from 'react';
import { BookStatus } from '@prisma/client';

interface BookProgress {
  status: BookStatus;
  totalPages?: number;
  completedPages?: number;
  failedPages?: number;
  timestamp: Date;
}

interface UseBookStatusStreamOptions {
  onStatusChange?: (status: BookStatus) => void;
  onProgress?: (progress: BookProgress) => void;
  onComplete?: (finalStatus: BookStatus) => void;
  enabled?: boolean;
}

export function useBookStatusStream(
  bookId: string | null,
  options: UseBookStatusStreamOptions = {}
) {
  const {
    onStatusChange,
    onProgress,
    onComplete,
    enabled = true,
  } = options;

  const [status, setStatus] = useState<BookStatus | null>(null);
  const [progress, setProgress] = useState<BookProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!bookId || !enabled) return;

    cleanup();

    try {
      const eventSource = new EventSource(`/api/book/${bookId}/status/stream`);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
        console.log(`[SSE] Connected to book status stream for ${bookId}`);
      };

      eventSource.onmessage = (event) => {
        try {
          const data: BookProgress = JSON.parse(event.data);
          setProgress(data);
          
          if (data.status !== status) {
            setStatus(data.status);
            onStatusChange?.(data.status);
          }
          
          onProgress?.(data);

          // Check for final status
          if (['COMPLETED', 'FAILED', 'PARTIAL'].includes(data.status)) {
            onComplete?.(data.status);
            cleanup();
          }
        } catch (error) {
          console.error('[SSE] Error parsing message:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.error('[SSE] Connection error:', error);
        setError('Connection error');
        cleanup();

        // Attempt reconnection with exponential backoff
        if (reconnectAttemptsRef.current < 5 && enabled) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
          reconnectAttemptsRef.current++;
          
          console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

    } catch (error) {
      console.error('[SSE] Failed to create EventSource:', error);
      setError('Failed to connect');
    }
  }, [bookId, enabled, status, onStatusChange, onProgress, onComplete, cleanup]);

  useEffect(() => {
    connect();
    return cleanup;
  }, [connect, cleanup]);

  return {
    status,
    progress,
    error,
    isConnected,
    reconnect: connect,
  };
}