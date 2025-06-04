"use client";

import React, { useRef, useEffect, useState } from 'react';
import RoughBorder from "@/components/ui/rough-border"; // Import RoughBorder
import type { Options as RoughOptions } from 'roughjs/bin/core';
import { cn } from "@/lib/utils";

interface RoughInputWrapperProps {
  children: React.ReactNode;
  className?: string;
  roughOptions?: RoughOptions;
  focusOptions?: RoughOptions; // Optional different options on focus
}

const RoughInputWrapper: React.FC<RoughInputWrapperProps> = ({ 
  children, 
  className, 
  roughOptions, 
  focusOptions
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isFocused, setIsFocused] = useState(false);
  const seedRef = useRef(Math.floor(Math.random() * 2**31));

  // Measure dimensions
  useEffect(() => {
    if (wrapperRef.current) {
      const updateDimensions = () => {
        if (wrapperRef.current) {
           setDimensions({ 
             width: wrapperRef.current.offsetWidth, 
             height: wrapperRef.current.offsetHeight 
           });
        }
      };
      updateDimensions();
      const resizeObserver = new ResizeObserver(updateDimensions);
      resizeObserver.observe(wrapperRef.current);
      return () => resizeObserver.disconnect();
    }
    return; // Explicit return for when wrapperRef.current is null
  }, []);

  // Default and focus border options (incorporating seed)
  const defaultRoughOptions: RoughOptions = {
    seed: seedRef.current,
    stroke: 'hsl(var(--input))', // Use the input border color CSS variable
    strokeWidth: 1.5,
    roughness: 1.8,
    bowing: 0.5,
    ...roughOptions,
  };

  const focusRoughOptionsCombined: RoughOptions = {
    seed: seedRef.current,
    ...defaultRoughOptions,
    stroke: 'hsl(var(--ring))', // FIX: Remove extra parenthesis
    strokeWidth: 2,
    roughness: 1.5,
    ...focusOptions, // Allow specific focus overrides
    ...roughOptions, // Allow base overrides even on focus
  };

  const currentOptions = isFocused ? focusRoughOptionsCombined : defaultRoughOptions;

  return (
    <div 
      ref={wrapperRef} 
      className={cn(
          "relative w-full block", // Explicitly set display: block
          className
        )} 
      onFocusCapture={() => setIsFocused(true)} 
      onBlurCapture={() => setIsFocused(false)}  
    >
      {/* Render children (Input/Textarea) */} 
      {children}
      
      {/* Render RoughBorder if dimensions are known */} 
      {dimensions.width > 0 && dimensions.height > 0 && (
        <RoughBorder 
          width={dimensions.width} 
          height={dimensions.height} 
          options={currentOptions}
          // Pass down className or specific styling if needed
        />
      )}
    </div>
  );
};

export default RoughInputWrapper; 