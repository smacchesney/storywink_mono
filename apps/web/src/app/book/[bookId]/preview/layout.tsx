import type { Viewport } from 'next';

// Scoped to the reader only: cover-mode lets the fixed reading overlay paint
// under the notch/home-indicator, and the overlay pads itself back out with
// safe-area insets. The root viewport stays untouched.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function BookPreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
