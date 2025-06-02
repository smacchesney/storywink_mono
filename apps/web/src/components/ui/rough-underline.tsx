"use client";

import React, { useRef, useEffect } from 'react';
import rough from 'roughjs/bin/rough'; 
import type { Options as RoughOptions } from 'roughjs/bin/core'; 

interface RoughUnderlineProps {
  width: number; // This will now be the *text* width
  color?: string;
  strokeWidth?: number;
  roughness?: number;
  options?: RoughOptions;
  className?: string; 
  extensionFactor?: number; // How much longer to make the underline (e.g., 1.2 = 20% longer)
}

const RoughUnderline: React.FC<RoughUnderlineProps> = ({ 
  width,
  color = '#4ECDC4', // Default to turquoise
  strokeWidth = 3,
  roughness = 2.5,
  options,
  className, 
  extensionFactor = 1.2 // Default to 20% longer
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  // Store a stable seed for this instance
  const seedRef = useRef(Math.floor(Math.random() * 2**31));
  
  // Calculate SVG dimensions based on extension
  const svgWidth = width * extensionFactor;
  const height = (strokeWidth * 3); // Keep height calculation

  useEffect(() => {
    if (!svgRef.current || width === 0) return;

    const rc = rough.svg(svgRef.current);
    let drawnElement: SVGGElement | null = null; 

    while (svgRef.current.firstChild) {
      svgRef.current.removeChild(svgRef.current.firstChild);
    }

    const y = height / 2; // Center the line vertically

    // Combine options with seed
    const combinedOptions: RoughOptions = { 
      seed: seedRef.current, // Add seed
      stroke: color,
      strokeWidth: strokeWidth,
      roughness: roughness,
      bowing: 1.5, // Add some bowing for more curve
      ...options 
    };

    // Draw the line slightly inset on left, extend almost fully to the right of SVG
    const padding = (combinedOptions.strokeWidth || 1.5) * 2;
    const x1 = padding; 
    const x2 = svgWidth - (padding / 2); // Reduce padding on right for extension

    const line = rc.line(
      x1,
      y, 
      x2, // Use adjusted x2
      y,
      combinedOptions
    );
    
    svgRef.current.appendChild(line);
    drawnElement = line;

    return () => {
       if (svgRef.current && drawnElement && svgRef.current.contains(drawnElement)) {
         try { svgRef.current.removeChild(drawnElement); } catch(e) {}
       }
    };
  }, [width, color, strokeWidth, roughness, options, extensionFactor]); 

  return (
    <svg
      ref={svgRef}
      width={svgWidth} // Use calculated SVG width
      height={height} 
      viewBox={`0 0 ${svgWidth} ${height}`} // Use calculated SVG width in viewBox
      className={`pointer-events-none ${className || ''}`} 
      aria-hidden="true" 
    />
  );
};

export default RoughUnderline; 