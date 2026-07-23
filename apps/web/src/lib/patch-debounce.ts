/**
 * X17 B4 — incremental persistence for the setup surface. Field changes
 * coalesce and PATCH ~800ms after the last edit so ramble/theme/cast
 * context survives an abandoned tab. Failures are silent: the submit PATCH
 * re-sends the full form, so a dropped debounce costs nothing.
 *
 * X18 (adversarial review #4): sends are SERIALIZED through one in-flight
 * chain and flush() awaits the whole chain — a submit that flushes while a
 * live PATCH is mid-air must order after it, or the older PATCH can land
 * after the submit PATCH and resurrect stale fields. An undefined-valued
 * key CANCELS the pending field outright (no empty {} PATCH).
 */
export const BOOK_PATCH_DEBOUNCE_MS = 800;

export interface PatchDebouncer {
  queue(fields: Record<string, unknown>): void;
  /** Send whatever is pending now and resolve after every in-flight send. */
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
  // Serialization chain: every send appends here; flush awaits the tail.
  let inFlight: Promise<void> = Promise.resolve();

  const drain = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const body = pending;
    pending = {};
    if (Object.keys(body).length === 0) return inFlight;
    inFlight = inFlight.then(async () => {
      try {
        await send(body);
      } catch {
        // Silent — the submit PATCH re-sends the full form.
      }
    });
    return inFlight;
  };

  return {
    queue(fields) {
      for (const [key, value] of Object.entries(fields)) {
        // undefined = cancel: the caller decided a previously queued value
        // must never flush (e.g. a name cleared mid-debounce).
        if (value === undefined) delete pending[key];
        else pending[key] = value;
      }
      if (timer) clearTimeout(timer);
      if (Object.keys(pending).length === 0) {
        timer = null;
        return;
      }
      timer = setTimeout(() => void drain(), delayMs);
    },
    async flush() {
      await drain();
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = {};
    },
  };
}
