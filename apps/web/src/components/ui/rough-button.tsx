"use client";

import React, { useRef, useEffect, useState } from 'react';
import rough from 'roughjs/bin/rough';
import type { Options as RoughOptions } from 'roughjs/bin/core';
import { Button } from "@/components/ui/button"; 
import { cn } from "@/lib/utils";

type OriginalButtonProps = React.ComponentProps<typeof Button>;

// Define props for the RoughButton, including isSelected
interface RoughButtonProps extends OriginalButtonProps {
  roughOptions?: RoughOptions;
  roughHoverOptions?: RoughOptions;
  roughActiveOptions?: RoughOptions;
  isSelected?: boolean;
}

const RoughButton: React.FC<RoughButtonProps> = ({
  children,
  roughOptions,
  roughHoverOptions,
  roughActiveOptions,
  isSelected = false,
  className,
  variant,
  size,
  ...props
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const seedRef = useRef(Math.floor(Math.random() * 2**31));

  // Get dimensions of the container
  useEffect(() => {
    if (containerRef.current) {
      const { offsetWidth, offsetHeight } = containerRef.current;
      setDimensions({ width: offsetWidth, height: offsetHeight });
      
      const resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
        }
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, []);

  // Draw the rough background
  useEffect(() => {
    if (!svgRef.current || dimensions.width === 0 || dimensions.height === 0) return;
    const rc = rough.svg(svgRef.current);
    const drawnElements: SVGGElement[] = [];
    while (svgRef.current.firstChild) {
      svgRef.current.removeChild(svgRef.current.firstChild);
    }

    // --- Define Colors and Options (incorporating seed) --- 
    const funColorFillSelected = 'rgba(78, 205, 196, 0.4)'; 
    const funColorStroke = '#00A095'; 
    const defaultFill = variant === 'default' || variant === null || variant === undefined ? 'hsl(var(--primary))' : 'transparent';
    const defaultStroke = variant === 'default' || variant === null || variant === undefined ? 'hsl(var(--primary-foreground))' : 'hsl(var(--primary))';

    const baseRoughOptions: RoughOptions = {
      seed: seedRef.current,
      roughness: 1.5, bowing: 0.8, stroke: defaultStroke, strokeWidth: 1.5,
      fill: defaultFill, fillStyle: 'hachure', fillWeight: 1, hachureGap: 4,
      preserveVertices: true, ...roughOptions,
    };

    const hoverRoughOptionsCombined: RoughOptions = {
        seed: seedRef.current,
        ...baseRoughOptions,
        stroke: funColorStroke, 
        strokeWidth: 2,
        fill: 'transparent',
        roughness: 1.8,
        bowing: 1.2, 
        ...roughHoverOptions, ...roughOptions,
    };
    
    const activeRoughOptionsCombined: RoughOptions = {
        seed: seedRef.current,
        ...hoverRoughOptionsCombined, 
        strokeWidth: 2.5,
        roughness: 1.2, 
        ...roughActiveOptions, ...roughHoverOptions, ...roughOptions, 
    };
    
    const selectedRoughOptions: RoughOptions = {
        seed: seedRef.current,
        ...baseRoughOptions, 
        stroke: funColorStroke, 
        strokeWidth: 2, 
        fill: funColorFillSelected, 
        fillStyle: 'zigzag', 
        fillWeight: 1.5, 
        hachureGap: 5,
        roughness: 2.0, 
        bowing: 1.2, 
        ...roughOptions,
    };

    // Determine current options 
    let currentOptions = baseRoughOptions;
    if (isSelected) {
        currentOptions = selectedRoughOptions;
    } else if (isActive) {
        currentOptions = activeRoughOptionsCombined;
    } else if (isHovered) {
        currentOptions = hoverRoughOptionsCombined;
    }

    // Always draw a rectangle
    const padding = (currentOptions.strokeWidth || 1.5);
    const drawWidth = Math.max(0, dimensions.width - padding);
    const drawHeight = Math.max(0, dimensions.height - padding);
    const drawX = padding / 2;
    const drawY = padding / 2;
    
    const shapeElement = rc.rectangle(drawX, drawY, drawWidth, drawHeight, currentOptions);
    
    if (shapeElement) {
        svgRef.current.appendChild(shapeElement);
        drawnElements.push(shapeElement);
    }

    // Cleanup function
    return () => {
      if (svgRef.current) {
        drawnElements.forEach(element => {
          try { if (svgRef.current?.contains(element)) svgRef.current.removeChild(element); } catch (e) { }
        });
      }
    };

  // Redraw when state, dimensions, options, or selection changes
  }, [dimensions, isHovered, isActive, isSelected, variant, roughOptions, roughHoverOptions, roughActiveOptions]); 

  // Determine text color AND weight based on state
  const originalTextColorClass = variant === 'default' || variant === null || variant === undefined ? 'text-primary-foreground' : 'text-primary';
  let textColorClass = originalTextColorClass;
  let fontWeightClass = 'font-medium'; 

  if (isSelected) {
    // Use black bold text when selected
    textColorClass = 'text-black'; 
    fontWeightClass = 'font-bold';
  } else if (isHovered || isActive) {
    // Use black bold text for hover/active when NOT selected
    textColorClass = 'text-black'; 
    fontWeightClass = 'font-bold'; 
  }

  return (
    <div 
      ref={containerRef} 
      className={cn(
          "relative inline-flex items-center justify-center",
          className
        )} 
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => { setIsHovered(false); setIsActive(false); }}
      onMouseDown={() => setIsActive(true)}
      onMouseUp={() => setIsActive(false)}
    >
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        viewBox={`-1 -1 ${dimensions.width + 2} ${dimensions.height + 2}`}
        className="absolute top-0 left-0 pointer-events-none" 
        aria-hidden="true"
      />
      <Button
        variant={variant} 
        size={size}
        className={cn(
            "relative z-10 bg-transparent border-none hover:bg-transparent focus:bg-transparent active:bg-transparent", 
            textColorClass, // Apply dynamic text color
            fontWeightClass, // Apply dynamic font weight
        )}
        {...props}
      >
        {children}
      </Button>
    </div>
  );
};

export default RoughButton; 