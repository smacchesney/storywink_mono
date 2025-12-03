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
    viewBox="20 0 44 30"
    fill="currentColor"
    className={cn("text-sky-soft", className)}
    style={style}
  >
    <path d="M52 28c5.5 0 10-4.5 10-10s-4.5-10-10-10c-1.2 0-2.3.2-3.4.6C46.8 3.6 42.8 0 38 0c-6.1 0-11 4.9-11 11 0 .4 0 .8.1 1.2C24.4 13.5 22 16.5 22 20c0 4.4 3.6 8 8 8h22z" />
  </svg>
);

const Rainbow = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg
    viewBox="0 0 48 28"
    fill="none"
    className={className}
    style={style}
  >
    {/* 3-color rainbow: coral, mint, sky */}
    <path
      d="M4 28C4 14.745 14.745 4 28 4C41.255 4 52 14.745 52 28"
      stroke="#F76C5E"
      strokeWidth="4"
      strokeLinecap="round"
      transform="translate(-4, 0)"
    />
    <path
      d="M10 28C10 18.059 18.059 10 28 10C37.941 10 46 18.059 46 28"
      stroke="#B8E4DC"
      strokeWidth="4"
      strokeLinecap="round"
      transform="translate(-4, 0)"
    />
    <path
      d="M16 28C16 21.373 21.373 16 28 16C34.627 16 40 21.373 40 28"
      stroke="#A8D5E5"
      strokeWidth="4"
      strokeLinecap="round"
      transform="translate(-4, 0)"
    />
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
  // Element counts based on variant - includes middle-zone elements
  const counts = {
    minimal: { stars: 4, hearts: 3, rainbows: 2, clouds: 3 },
    default: { stars: 12, hearts: 8, rainbows: 6, clouds: 8 },
    dense: { stars: 16, hearts: 10, rainbows: 10, clouds: 12 },
  };

  const count = counts[variant];

  // Generate scattered positions - interleaved for even distribution across all types
  // Elements are ordered so that when filtered, each type appears throughout the page
  const scatteredElements = [
    // Row 1: Top section (0-15%)
    { type: 'star', top: '3%', left: '4%', size: 16, opacity: 0.12, rotate: 15 },
    { type: 'heart', top: '5%', right: '6%', size: 14, opacity: 0.11, rotate: -15 },
    { type: 'rainbow', top: '8%', left: '15%', size: 32, opacity: 0.1 },
    { type: 'cloud', top: '4%', right: '18%', size: 38, opacity: 0.09 },

    // Row 2: Upper section (15-30%)
    { type: 'star', top: '18%', right: '5%', size: 14, opacity: 0.11, rotate: -20 },
    { type: 'heart', top: '20%', left: '3%', size: 13, opacity: 0.1, rotate: 20 },
    { type: 'rainbow', top: '22%', right: '15%', size: 28, opacity: 0.09, rotate: 10 },
    { type: 'cloud', top: '25%', left: '8%', size: 35, opacity: 0.08 },

    // Row 3: Upper-middle section (30-45%)
    { type: 'star', top: '32%', left: '6%', size: 15, opacity: 0.1, rotate: 30 },
    { type: 'heart', top: '35%', right: '4%', size: 15, opacity: 0.11, rotate: -25 },
    { type: 'rainbow', top: '38%', left: '20%', size: 30, opacity: 0.08, rotate: -5 },
    { type: 'cloud', top: '40%', right: '10%', size: 32, opacity: 0.09 },

    // Row 4: Middle section (45-60%)
    { type: 'star', top: '48%', right: '6%', size: 17, opacity: 0.12, rotate: -35 },
    { type: 'heart', top: '50%', left: '5%', size: 14, opacity: 0.1, rotate: 15 },
    { type: 'rainbow', top: '52%', right: '18%', size: 26, opacity: 0.09, rotate: 8 },
    { type: 'cloud', top: '55%', left: '12%', size: 30, opacity: 0.08 },

    // Row 5: Lower-middle section (60-75%)
    { type: 'star', top: '62%', left: '4%', size: 14, opacity: 0.11, rotate: 45 },
    { type: 'heart', top: '65%', right: '5%', size: 13, opacity: 0.1, rotate: -10 },
    { type: 'rainbow', top: '68%', left: '16%', size: 34, opacity: 0.1, rotate: -8 },
    { type: 'cloud', top: '70%', right: '8%', size: 36, opacity: 0.09 },

    // Row 6: Lower section (75-90%)
    { type: 'star', top: '78%', right: '4%', size: 16, opacity: 0.1, rotate: -60 },
    { type: 'heart', top: '80%', left: '6%', size: 12, opacity: 0.11, rotate: 25 },
    { type: 'rainbow', top: '82%', right: '20%', size: 28, opacity: 0.08, rotate: 5 },
    { type: 'cloud', top: '85%', left: '10%', size: 34, opacity: 0.09 },

    // Row 7: Bottom section (90%+)
    { type: 'star', top: '92%', left: '8%', size: 13, opacity: 0.1, rotate: 70 },
    { type: 'heart', top: '94%', right: '7%', size: 14, opacity: 0.1, rotate: -20 },

    // Middle-zone elements for desktop (28-38% from edges) - subtle, smaller
    // These fill the gap between edges and center content area
    { type: 'star', top: '6%', left: '32%', size: 11, opacity: 0.07, rotate: 20 },
    { type: 'star', top: '24%', right: '30%', size: 10, opacity: 0.06, rotate: -30 },
    { type: 'star', top: '44%', left: '28%', size: 12, opacity: 0.07, rotate: 40 },
    { type: 'star', top: '66%', right: '32%', size: 11, opacity: 0.06, rotate: -50 },
    { type: 'heart', top: '14%', right: '35%', size: 10, opacity: 0.06, rotate: 15 },
    { type: 'heart', top: '36%', left: '30%', size: 9, opacity: 0.06, rotate: -20 },
    { type: 'rainbow', top: '30%', right: '28%', size: 20, opacity: 0.05, rotate: 8 },
    { type: 'cloud', top: '56%', left: '34%', size: 24, opacity: 0.05 },
    { type: 'cloud', top: '76%', right: '30%', size: 22, opacity: 0.05 },

    // Extra elements for dense variant - spread throughout
    { type: 'star', top: '12%', left: '25%', size: 12, opacity: 0.08, rotate: 25 },
    { type: 'star', top: '42%', right: '22%', size: 11, opacity: 0.09, rotate: -45 },
    { type: 'star', top: '72%', left: '22%', size: 13, opacity: 0.08, rotate: 55 },
    { type: 'star', top: '88%', right: '15%', size: 12, opacity: 0.09, rotate: -30 },
    { type: 'heart', top: '28%', left: '18%', size: 11, opacity: 0.08, rotate: 30 },
    { type: 'heart', top: '58%', right: '16%', size: 10, opacity: 0.08, rotate: -15 },
    { type: 'rainbow', top: '15%', right: '25%', size: 24, opacity: 0.07, rotate: 12 },
    { type: 'rainbow', top: '45%', left: '25%', size: 22, opacity: 0.07, rotate: -10 },
    { type: 'rainbow', top: '75%', right: '25%', size: 26, opacity: 0.07, rotate: 6 },
    { type: 'cloud', top: '15%', left: '25%', size: 28, opacity: 0.06 },
    { type: 'cloud', top: '48%', right: '22%', size: 30, opacity: 0.06 },
    { type: 'cloud', top: '75%', left: '22%', size: 26, opacity: 0.06 },
    { type: 'cloud', top: '95%', right: '18%', size: 32, opacity: 0.07 },
  ];

  // Filter elements based on variant
  const getVisibleElements = () => {
    const filtered = [];
    let starCount = 0, heartCount = 0, rainbowCount = 0, cloudCount = 0;

    for (const el of scatteredElements) {
      if (el.type === 'star' && starCount < count.stars) {
        filtered.push(el);
        starCount++;
      } else if (el.type === 'heart' && heartCount < count.hearts) {
        filtered.push(el);
        heartCount++;
      } else if (el.type === 'rainbow' && rainbowCount < count.rainbows) {
        filtered.push(el);
        rainbowCount++;
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

      {/* Scattered elements - all visible on mobile and desktop */}
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

        if (el.type === 'star') {
          return <Star key={`star-${index}`} style={style} />;
        }
        if (el.type === 'heart') {
          return <Heart key={`heart-${index}`} style={style} />;
        }
        if (el.type === 'rainbow') {
          return (
            <Rainbow
              key={`rainbow-${index}`}
              style={{
                ...style,
                width: `${el.size}px`,
                height: `${el.size * 0.6}px`,
              }}
            />
          );
        }
        if (el.type === 'cloud') {
          return (
            <Cloud
              key={`cloud-${index}`}
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
