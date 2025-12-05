"use client";

import React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { STYLE_LIBRARY } from '@storywink/shared/prompts/styles';
import { optimizeCloudinaryUrl } from '@storywink/shared';

interface StyleDefinition {
  label: string;
  referenceImageUrls: readonly string[];
}

interface ArtStylePickerProps {
  currentStyle: string | null | undefined;
  onStyleChange: (styleKey: string) => void;
}

export function ArtStylePicker({
  currentStyle,
  onStyleChange,
}: ArtStylePickerProps) {
  const styles = Object.entries(STYLE_LIBRARY) as [string, StyleDefinition][];

  return (
    <div className="p-2 space-y-4">
      {/* Style Selection Grid */}
      <div>
        <div className="grid grid-cols-3 gap-2 md:gap-3">
          {styles.map(([key, style]) => (
            <Card
              key={key}
              onClick={() => onStyleChange(key)}
              className={cn(
                "cursor-pointer overflow-hidden transition-all hover:shadow-md",
                currentStyle === key ? "ring-2 ring-[#F76C5E] ring-offset-2" : "ring-0"
              )}
            >
              <CardContent className="p-0 aspect-square relative max-h-[120px]">
                <Image
                  src={optimizeCloudinaryUrl(style.referenceImageUrls[0])}
                  alt={style.label}
                  fill
                  sizes="(max-width: 768px) 50vw, 33vw"
                  style={{ objectFit: "cover" }}
                />
                <div
                    className={cn(
                        // Base style: Black gradient for text visibility
                        "absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent text-white"
                    )}
                >
                    <p className="text-[10px] md:text-xs font-medium truncate">{style.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ArtStylePicker;
