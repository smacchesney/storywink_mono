'use client';

import React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface FaceCardProps {
  faceImageUrl: string;
  frequency: number;
  isSelected: boolean;
  name: string;
  onToggleSelect: () => void;
  onNameChange: (name: string) => void;
}

export function FaceCard({
  faceImageUrl,
  frequency,
  isSelected,
  name,
  onToggleSelect,
  onNameChange,
}: FaceCardProps) {
  return (
    <div className="flex flex-col">
      {/* Face Image Card */}
      <button
        type="button"
        onClick={onToggleSelect}
        className={cn(
          'relative aspect-square rounded-xl overflow-hidden',
          'transition-all duration-200 ease-out',
          'active:scale-95',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F76C5E] focus-visible:ring-offset-2',
          isSelected
            ? 'ring-4 ring-[#F76C5E] ring-offset-2 shadow-lg'
            : 'ring-1 ring-gray-200 hover:ring-2 hover:ring-gray-300 hover:shadow-md'
        )}
      >
        {/* Face Image */}
        <Image
          src={faceImageUrl}
          alt="Detected face"
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
          className="object-cover"
        />

        {/* Frequency Badge */}
        <div className="absolute top-2 left-2">
          <span className="bg-white/90 backdrop-blur-sm text-gray-700 text-xs font-medium px-2 py-1 rounded-full shadow-sm">
            {frequency} {frequency === 1 ? 'photo' : 'photos'}
          </span>
        </div>

        {/* Selection Checkmark */}
        <div
          className={cn(
            'absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center',
            'transition-all duration-200',
            isSelected
              ? 'bg-[#F76C5E] text-white scale-100'
              : 'bg-white/80 text-gray-400 scale-90 opacity-0 group-hover:opacity-100'
          )}
        >
          <Check className="w-4 h-4" strokeWidth={3} />
        </div>

        {/* Hover overlay */}
        {!isSelected && (
          <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors" />
        )}
      </button>

      {/* Name Input (shown when selected) */}
      <div
        className={cn(
          'mt-2 transition-all duration-200 overflow-hidden',
          isSelected ? 'max-h-16 opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Enter name..."
          className={cn(
            'w-full px-3 py-2 text-sm rounded-lg',
            'border-2 border-[#F76C5E]/30 focus:border-[#F76C5E]',
            'bg-white focus:bg-white',
            'placeholder:text-gray-400',
            'outline-none transition-colors',
            'font-medium text-center'
          )}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}

export default FaceCard;
