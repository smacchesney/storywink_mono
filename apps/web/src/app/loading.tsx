import PlayfulBackground from '@/components/ui/playful-background';
import { Storydust } from '@/components/ui/storydust';

/**
 * Route-level loading state — sub-second, so no copy: just the calm wash and
 * a winking twinkle while the next page arrives.
 */
export default function Loading() {
  return (
    <div className="relative flex min-h-[70vh] items-center justify-center">
      <PlayfulBackground variant="minimal" />
      <Storydust variant="twinkle" size="card" className="relative" />
    </div>
  );
}
