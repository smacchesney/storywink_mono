"use client";

import React from 'react';
import { cn } from '@/lib/utils';

interface PlayfulBackgroundProps {
  variant?: 'default' | 'minimal' | 'dense';
  showCornerDoodles?: boolean;
  className?: string;
}

// SVG Components for decorations
const Star = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={cn("text-coral-primary", className)}
    style={style}
  >
    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
  </svg>
);

const Heart = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={cn("text-[#F76C5E]", className)}
    style={style}
  >
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
);

const Cloud = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg
    viewBox="0 0 64 40"
    fill="currentColor"
    className={cn("text-sky-soft", className)}
    style={style}
  >
    <path d="M52 28c5.5 0 10-4.5 10-10s-4.5-10-10-10c-1.2 0-2.3.2-3.4.6C46.8 3.6 42.8 0 38 0c-6.1 0-11 4.9-11 11 0 .4 0 .8.1 1.2C24.4 13.5 22 16.5 22 20c0 4.4 3.6 8 8 8h22zM12 40c6.6 0 12-5.4 12-12S18.6 16 12 16 0 21.4 0 28s5.4 12 12 12z" />
  </svg>
);

const Circle = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    style={style}
  >
    <circle cx="12" cy="12" r="10" />
  </svg>
);

const Sun = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg
    viewBox="0 0 64 64"
    fill="currentColor"
    className={cn("text-[#FFD700]", className)}
    style={style}
  >
    <circle cx="32" cy="32" r="16" />
    <path d="M32 4v8M32 52v8M4 32h8M52 32h8M12.2 12.2l5.7 5.7M46.1 46.1l5.7 5.7M12.2 51.8l5.7-5.7M46.1 17.9l5.7-5.7"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

/**
 * PlayfulBackground - A reusable component with scattered whimsical SVG decorations
 * Use this as a background layer for pages to add a toddler-playful aesthetic
 */
const PlayfulBackground: React.FC<PlayfulBackgroundProps> = ({
  variant = 'default',
  showCornerDoodles = true,
  className,
}) => {
  // Element counts based on variant - increased density
  const counts = {
    minimal: { stars: 5, hearts: 3, circles: 3, clouds: 3 },
    default: { stars: 10, hearts: 5, circles: 6, clouds: 6 },
    dense: { stars: 16, hearts: 8, circles: 10, clouds: 10 },
  };

  const count = counts[variant];

  // Generate scattered positions with some randomness but stable per-render
  // Using predetermined positions for consistency - increased density
  const scatteredElements = [
    // Stars - scattered across the page (more of them)
    { type: 'star', top: '5%', left: '5%', size: 16, opacity: 0.1, rotate: 15 },
    { type: 'star', top: '12%', right: '8%', size: 14, opacity: 0.12, rotate: -20 },
    { type: 'star', top: '18%', left: '18%', size: 12, opacity: 0.08, rotate: 30 },
    { type: 'star', top: '25%', right: '22%', size: 18, opacity: 0.1, rotate: -10 },
    { type: 'star', top: '32%', left: '3%', size: 14, opacity: 0.09, rotate: 45 },
    { type: 'star', top: '40%', right: '5%', size: 16, opacity: 0.11, rotate: -35 },
    { type: 'star', top: '48%', left: '12%', size: 13, opacity: 0.08, rotate: 60 },
    { type: 'star', top: '55%', right: '15%', size: 15, opacity: 0.1, rotate: -60 },
    { type: 'star', top: '62%', left: '6%', size: 11, opacity: 0.09, rotate: 90 },
    { type: 'star', top: '70%', right: '3%', size: 17, opacity: 0.11, rotate: -90 },
    { type: 'star', top: '78%', left: '20%', size: 14, opacity: 0.08, rotate: 25 },
    { type: 'star', top: '85%', right: '18%', size: 12, opacity: 0.1, rotate: -45 },
    { type: 'star', top: '92%', left: '8%', size: 15, opacity: 0.09, rotate: 70 },
    { type: 'star', top: '35%', left: '28%', size: 10, opacity: 0.07, rotate: -15 },
    { type: 'star', top: '58%', right: '28%', size: 11, opacity: 0.07, rotate: 40 },
    { type: 'star', top: '88%', right: '10%', size: 13, opacity: 0.08, rotate: -70 },

    // Hearts - spread across the page
    { type: 'heart', top: '8%', left: '3%', size: 14, opacity: 0.1, rotate: -15 },
    { type: 'heart', top: '22%', right: '4%', size: 12, opacity: 0.09, rotate: 20 },
    { type: 'heart', top: '38%', left: '10%', size: 16, opacity: 0.11, rotate: -25 },
    { type: 'heart', top: '52%', right: '8%', size: 13, opacity: 0.08, rotate: 15 },
    { type: 'heart', top: '68%', left: '4%', size: 14, opacity: 0.1, rotate: -10 },
    { type: 'heart', top: '82%', right: '6%', size: 11, opacity: 0.09, rotate: 25 },
    { type: 'heart', top: '45%', left: '25%', size: 10, opacity: 0.07, rotate: -20 },
    { type: 'heart', top: '75%', right: '25%', size: 12, opacity: 0.08, rotate: 30 },

    // Circles - soft colored dots
    { type: 'circle', top: '10%', left: '15%', size: 10, opacity: 0.08, color: '#B8E4DC' },
    { type: 'circle', top: '20%', right: '12%', size: 8, opacity: 0.09, color: '#D4C4E8' },
    { type: 'circle', top: '30%', left: '7%', size: 12, opacity: 0.07, color: '#A8D5E5' },
    { type: 'circle', top: '42%', right: '20%', size: 9, opacity: 0.08, color: '#FFDAB3' },
    { type: 'circle', top: '55%', left: '18%', size: 11, opacity: 0.07, color: '#B8E4DC' },
    { type: 'circle', top: '65%', right: '10%', size: 10, opacity: 0.08, color: '#D4C4E8' },
    { type: 'circle', top: '78%', left: '12%', size: 9, opacity: 0.07, color: '#A8D5E5' },
    { type: 'circle', top: '88%', right: '15%', size: 11, opacity: 0.08, color: '#FFDAB3' },
    { type: 'circle', top: '48%', left: '3%', size: 8, opacity: 0.06, color: '#B8E4DC' },
    { type: 'circle', top: '72%', right: '4%', size: 10, opacity: 0.07, color: '#D4C4E8' },

    // Small clouds - scattered throughout
    { type: 'cloud', top: '6%', left: '8%', size: 35, opacity: 0.08 },
    { type: 'cloud', top: '15%', right: '5%', size: 30, opacity: 0.07 },
    { type: 'cloud', top: '28%', left: '2%', size: 40, opacity: 0.06 },
    { type: 'cloud', top: '42%', right: '3%', size: 32, opacity: 0.08 },
    { type: 'cloud', top: '55%', left: '5%', size: 28, opacity: 0.07 },
    { type: 'cloud', top: '68%', right: '8%', size: 36, opacity: 0.06 },
    { type: 'cloud', top: '80%', left: '10%', size: 30, opacity: 0.08 },
    { type: 'cloud', top: '90%', right: '12%', size: 34, opacity: 0.07 },
    { type: 'cloud', top: '35%', left: '22%', size: 26, opacity: 0.05 },
    { type: 'cloud', top: '62%', right: '20%', size: 28, opacity: 0.05 },
  ];

  // Filter elements based on variant
  const getVisibleElements = () => {
    const filtered = [];
    let starCount = 0, heartCount = 0, circleCount = 0, cloudCount = 0;

    for (const el of scatteredElements) {
      if (el.type === 'star' && starCount < count.stars) {
        filtered.push(el);
        starCount++;
      } else if (el.type === 'heart' && heartCount < count.hearts) {
        filtered.push(el);
        heartCount++;
      } else if (el.type === 'circle' && circleCount < count.circles) {
        filtered.push(el);
        circleCount++;
      } else if (el.type === 'cloud' && cloudCount < count.clouds) {
        filtered.push(el);
        cloudCount++;
      }
    }
    return filtered;
  };

  const visibleElements = getVisibleElements();

  return (
    <div
      className={cn(
        "fixed inset-0 overflow-hidden pointer-events-none z-0",
        className
      )}
      aria-hidden="true"
    >
      {/* Corner doodles */}
      {showCornerDoodles && (
        <>
          {/* Top-left cloud */}
          <Cloud
            className="absolute w-20 h-12 sm:w-28 sm:h-16 md:w-36 md:h-20"
            style={{
              top: '5%',
              left: '-2%',
              opacity: 0.08,
              transform: 'rotate(-5deg)',
            }}
          />

          {/* Top-right sun */}
          <Sun
            className="absolute w-16 h-16 sm:w-20 sm:h-20 md:w-28 md:h-28 hidden sm:block"
            style={{
              top: '3%',
              right: '2%',
              opacity: 0.06,
            }}
          />

          {/* Bottom-right cloud (smaller) */}
          <Cloud
            className="absolute w-16 h-10 sm:w-24 sm:h-14 hidden md:block"
            style={{
              bottom: '8%',
              right: '5%',
              opacity: 0.06,
              transform: 'rotate(10deg) scaleX(-1)',
            }}
          />
        </>
      )}

      {/* Scattered elements */}
      {visibleElements.map((el, index) => {
        const style: React.CSSProperties = {
          position: 'absolute',
          width: `${el.size}px`,
          height: `${el.size}px`,
          opacity: el.opacity,
          transform: el.rotate ? `rotate(${el.rotate}deg)` : undefined,
          ...(el.top && { top: el.top }),
          ...(el.left && { left: el.left }),
          ...(el.right && { right: el.right }),
        };

        // Hide some elements on mobile for cleaner look
        const mobileHideClass = index > (variant === 'minimal' ? 4 : 8) ? 'hidden sm:block' : '';

        if (el.type === 'star') {
          return <Star key={`star-${index}`} className={mobileHideClass} style={style} />;
        }
        if (el.type === 'heart') {
          return <Heart key={`heart-${index}`} className={mobileHideClass} style={style} />;
        }
        if (el.type === 'circle') {
          return (
            <Circle
              key={`circle-${index}`}
              className={mobileHideClass}
              style={{
                ...style,
                color: (el as { color?: string }).color || '#B8E4DC',
              }}
            />
          );
        }
        if (el.type === 'cloud') {
          return (
            <Cloud
              key={`cloud-${index}`}
              className={mobileHideClass}
              style={{
                ...style,
                width: `${el.size}px`,
                height: `${el.size * 0.6}px`,
              }}
            />
          );
        }
        return null;
      })}
    </div>
  );
};

export default PlayfulBackground;
