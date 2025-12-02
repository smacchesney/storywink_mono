"use client";

import React, { useRef, useState, useEffect } from 'react';
import RoughBorder from './rough-border';
import { cn } from '@/lib/utils';

interface StorybookFrameProps {
  children: React.ReactNode;
  className?: string;
  borderColor?: string;
  backgroundColor?: string;
  /** Show a subtle page curl effect in bottom right corner */
  showPageCurl?: boolean;
}

/**
 * A storybook-style frame with hand-drawn Rough.js borders
 * Used for wrapping carousel images and other content to give a "book page" feel
 */
const StorybookFrame: React.FC<StorybookFrameProps> = ({
  children,
  className,
  borderColor = 'var(--coral-primary)',
  backgroundColor = '#FFFFFF',
  showPageCurl = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        const { offsetWidth, offsetHeight } = containerRef.current;
        setDimensions({ width: offsetWidth, height: offsetHeight });
      }
    };

    // Initial measurement
    updateDimensions();

    // Set up ResizeObserver for responsive updates
    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative rounded-lg overflow-hidden",
        className
      )}
      style={{ backgroundColor }}
    >
      {/* Rough.js hand-drawn border */}
      {dimensions.width > 0 && dimensions.height > 0 && (
        <RoughBorder
          width={dimensions.width}
          height={dimensions.height}
          options={{
            stroke: borderColor,
            strokeWidth: 2.5,
            roughness: 1.2,
            bowing: 0.6,
          }}
        />
      )}

      {/* Content */}
      <div className="relative z-10 p-2">
        {children}
      </div>

      {/* Page curl effect - subtle shadow in bottom right */}
      {showPageCurl && (
        <div
          className="absolute bottom-0 right-0 w-8 h-8 pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.05) 50%, rgba(0,0,0,0.1) 100%)',
            borderTopLeftRadius: '100%',
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
};

export default StorybookFrame;
