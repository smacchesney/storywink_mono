'use client';

import React from 'react';
import { FaceCard } from './FaceCard';
import type { FaceCluster } from '@/lib/face-detection';

export interface SelectedCharacter {
  clusterId: string;
  name: string;
  sourceAssetId: string;
  faceBounds: { x: number; y: number; width: number; height: number };
  imageUrl: string;
}

interface FaceGridProps {
  clusters: FaceCluster[];
  facePreviewUrls: Map<string, string>;
  selectedCharacters: SelectedCharacter[];
  onToggleCharacter: (cluster: FaceCluster) => void;
  onNameChange: (clusterId: string, name: string) => void;
}

export function FaceGrid({
  clusters,
  facePreviewUrls,
  selectedCharacters,
  onToggleCharacter,
  onNameChange,
}: FaceGridProps) {
  if (clusters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-20 h-20 mb-4 rounded-full bg-gray-100 flex items-center justify-center">
          <svg
            className="w-10 h-10 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          No faces detected
        </h3>
        <p className="text-gray-500 max-w-xs">
          We couldn&apos;t find any faces in your photos. Don&apos;t worry - you can
          still continue with your book!
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
      {clusters.map((cluster) => {
        const selectedChar = selectedCharacters.find(
          (c) => c.clusterId === cluster.id
        );
        const isSelected = !!selectedChar;
        const previewUrl = facePreviewUrls.get(cluster.id) || cluster.bestFace.imageUrl;

        return (
          <FaceCard
            key={cluster.id}
            faceImageUrl={previewUrl}
            frequency={cluster.frequency}
            isSelected={isSelected}
            name={selectedChar?.name || ''}
            onToggleSelect={() => onToggleCharacter(cluster)}
            onNameChange={(name) => onNameChange(cluster.id, name)}
          />
        );
      })}
    </div>
  );
}

export default FaceGrid;
