"use client";

import React from 'react';
import { cn } from '@/lib/utils';

interface StatsCounterProps {
  count: number;
  text: string;
  className?: string;
}

const StatsCounter: React.FC<StatsCounterProps> = ({ count, text, className }) => {
  // Format number with commas
  const formattedCount = count.toLocaleString();

  return (
    <div className={cn("text-center text-sm text-slate-500 dark:text-slate-400", className)}>
      {/* Add user avatar icons here if desired */}
      {/* <div className="flex justify-center -space-x-2 mb-1">...</div> */}
      <span>
        <strong>{formattedCount}</strong> {text}
      </span>
    </div>
  );
};

export default StatsCounter; 