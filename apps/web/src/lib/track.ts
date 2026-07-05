/**
 * Fire-and-forget client-side funnel telemetry.
 *
 * Never throws and never needs awaiting — a telemetry failure must never
 * touch the UX. keepalive lets events fired right before navigation land.
 */
export function track(
  name: string,
  options: { bookId?: string; props?: Record<string, unknown> } = {}
): void {
  try {
    void fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        ...(options.bookId !== undefined ? { bookId: options.bookId } : {}),
        ...(options.props !== undefined ? { props: options.props } : {}),
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Ignore — telemetry only.
  }
}
