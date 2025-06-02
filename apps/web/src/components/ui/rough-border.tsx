"use client";

import React, { useRef, useEffect } from 'react';
import rough from 'roughjs/bin/rough'; 
import type { Options as RoughOptions } from 'roughjs/bin/core'; 

interface RoughBorderProps {
  width: number;
  height: number;
  options?: RoughOptions;
  className?: string; 
}

const RoughBorder: React.FC<RoughBorderProps> = ({ 
  width, 
  height, 
  options, 
  className 
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  // Store a stable seed for this instance
  const seedRef = useRef(Math.floor(Math.random() * 2**31)); 

  useEffect(() => {
    if (!svgRef.current || width === 0 || height === 0) return;

    const rc = rough.svg(svgRef.current);
    let drawnElement: SVGGElement | null = null; 
    
    while (svgRef.current.firstChild) {
      svgRef.current.removeChild(svgRef.current.firstChild);
    }

    // Combine passed options with defaults and the stable seed
    const combinedOptions: RoughOptions = { 
      seed: seedRef.current, // Use the stored seed
      roughness: 1.5, 
      bowing: 0.8, 
      stroke: 'currentColor',
      strokeWidth: 2.5, 
      preserveVertices: true,
      ...options 
    };

    const padding = (combinedOptions.strokeWidth || 1.5) * 2;
    const drawableWidth = width - padding;
    const drawableHeight = height - padding;
    const x = padding / 2;
    const y = padding / 2;

    drawnElement = rc.rectangle(x, y, drawableWidth, drawableHeight, combinedOptions);
    
    if (drawnElement) {
      svgRef.current.appendChild(drawnElement);
    }

    // Cleanup function
    return () => {
       if (svgRef.current && drawnElement && svgRef.current.contains(drawnElement)) {
         try { svgRef.current.removeChild(drawnElement); } catch(e) {}
       }
    };
  }, [width, height, options]); // Seed is stable, no need in dependency array

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`absolute top-0 left-0 pointer-events-none ${className || ''}`} 
      aria-hidden="true" 
    />
  );
};

export default RoughBorder; 