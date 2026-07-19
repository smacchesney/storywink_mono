/**
 * X17 B4 — incremental persistence for the setup surface. Field changes
 * coalesce and PATCH ~800ms after the last edit so ramble/theme/cast
 * context survives an abandoned tab. Failures are silent: the submit PATCH
 * re-sends the full form, so a dropped debounce costs nothing.
 */
export const BOOK_PATCH_DEBOUNCE_MS = 800;

export interface PatchDebouncer {
  queue(fields: Record<string, unknown>): void;
  /** Send whatever is pending now (pre-submit). */
  flush(): Promise<void>;
  /** Cancel the timer and drop pending fields (unmount / submit). */
  dispose(): void;
}

export function createPatchDebouncer(
  send: (body: Record<string, unknown>) => Promise<void>,
  delayMs: number = BOOK_PATCH_DEBOUNCE_MS,
): PatchDebouncer {
  let pending: Record<string, unknown> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const body = pending;
    pending = {};
    if (Object.keys(body).length === 0) return;
    try {
      await send(body);
    } catch {
      // Silent — the submit PATCH re-sends the full form.
    }
  };

  return {
    queue(fields) {
      Object.assign(pending, fields);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = {};
    },
  };
}
