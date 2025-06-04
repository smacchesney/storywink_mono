"use client";

import React from 'react';
import Image from 'next/image';
import { Asset } from '@prisma/client';
import { Check } from 'lucide-react'; // Import Check icon
import { cn } from '@/lib/utils'; // Import cn if not already there

interface CoverEditorPanelProps {
  allBookAssets: Asset[]; // Renamed from availableAssets
  currentCoverAssetId: string | null | undefined;
  onCoverAssetSelect: (assetId: string | null) => void;
  // Removed props: currentTitle, currentChildName, onTitleChange, onChildNameChange
}

export function CoverEditorPanel({
  allBookAssets, // Renamed
  currentCoverAssetId,
  onCoverAssetSelect,
}: CoverEditorPanelProps) {
  // const [activeSubTab, setActiveSubTab] = useState("photo"); // No longer needed

  // const currentCoverAsset = allBookAssets.find(a => a.id === currentCoverAssetId); // Unused

  return (
    <div className="p-2 space-y-4 h-full flex flex-col">
      {/* Tabs structure removed, directly rendering photo selection content */}
      <div className="flex-grow overflow-auto pt-4 space-y-4">
          
          {/* REMOVED Current Cover Preview & Cropper Placeholder */}
          
          {/* Available Assets Grid */}
          <div>
            {/* <Label className="text-sm font-semibold mb-2 block">Select Cover Photo</Label> */}
            <div className="grid grid-cols-3 gap-2">
                {allBookAssets.map((asset) => {
                    const isSelected = asset.id === currentCoverAssetId;
                    return (
                        <button 
                            key={asset.id} 
                            onClick={() => onCoverAssetSelect(asset.id)}
                            className={cn(
                                "relative aspect-square rounded-md overflow-hidden border-2 border-transparent transition-all",
                                "hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-2", // Base focus ring styles
                                isSelected 
                                    ? "border-[#F76C5E] ring-[#F76C5E] ring-offset-1" // Selected: Coral border & ring (focus uses this ring too)
                                    : "border-gray-200 focus:ring-transparent" // Not selected: Gray border, transparent focus ring
                            )}
                            aria-pressed={isSelected}
                        >
                            <Image 
                                src={asset.thumbnailUrl || asset.url} 
                                alt={`Asset ${asset.id}`}
                                fill
                                style={{ objectFit: "cover" }}
                                className={cn(isSelected ? "opacity-80" : "opacity-100")} // Slightly dim selected image
                            />
                            {isSelected && (
                                <div className="absolute bottom-1 right-1 z-10 bg-[#F76C5E] rounded-full p-0.5">
                                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                                </div>
                            )}
                        </button>
                    )
                })}
                {allBookAssets.length === 0 && (
                    <p className="col-span-3 text-sm text-muted-foreground text-center py-4">No photos found for this book.</p>
                )}
            </div>
          </div>
        </div>
    </div>
  );
}

export default CoverEditorPanel; 