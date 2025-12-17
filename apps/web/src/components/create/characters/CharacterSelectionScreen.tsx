'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { FaceGrid, type SelectedCharacter } from './FaceGrid';
import { CharacterConfirmFooter } from './CharacterConfirmFooter';
import {
  detectAndClusterFaces,
  generateFacePreview,
  cropFaceFromImage,
  type FaceCluster,
} from '@/lib/face-detection';
import logger from '@/lib/logger';

interface Photo {
  assetId: string;
  url: string;
}

interface CharacterSelectionScreenProps {
  bookId: string;
  photos: Photo[];
}

export function CharacterSelectionScreen({
  bookId,
  photos,
}: CharacterSelectionScreenProps) {
  const router = useRouter();
  const { getToken } = useAuth();

  // State
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('Loading face detection models...');
  const [clusters, setClusters] = useState<FaceCluster[]>([]);
  const [facePreviewUrls, setFacePreviewUrls] = useState<Map<string, string>>(
    new Map()
  );
  const [selectedCharacters, setSelectedCharacters] = useState<
    SelectedCharacter[]
  >([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Run face detection on mount
  useEffect(() => {
    let cancelled = false;

    const runDetection = async () => {
      try {
        setLoadingMessage('Analyzing photos for faces...');

        const detectedClusters = await detectAndClusterFaces(
          photos,
          (completed, total) => {
            if (!cancelled) {
              setLoadingProgress(Math.round((completed / total) * 80));
              setLoadingMessage(
                `Analyzing photo ${completed} of ${total}...`
              );
            }
          }
        );

        if (cancelled) return;

        setClusters(detectedClusters);
        setLoadingProgress(90);
        setLoadingMessage('Preparing face previews...');

        // Generate preview images for each cluster
        const previews = new Map<string, string>();
        for (const cluster of detectedClusters) {
          if (cancelled) return;
          try {
            const preview = await generateFacePreview(
              cluster.bestFace.imageUrl,
              cluster.bestFace.box
            );
            previews.set(cluster.id, preview);
          } catch (error) {
            logger.warn(
              { error, clusterId: cluster.id },
              'Failed to generate face preview'
            );
          }
        }

        if (!cancelled) {
          setFacePreviewUrls(previews);
          setLoadingProgress(100);

          // If only one face detected with high frequency, auto-select it
          if (
            detectedClusters.length === 1 &&
            detectedClusters[0].frequency >= 2
          ) {
            const cluster = detectedClusters[0];
            setSelectedCharacters([
              {
                clusterId: cluster.id,
                name: '',
                sourceAssetId: cluster.bestFace.assetId,
                faceBounds: cluster.bestFace.box,
                imageUrl: cluster.bestFace.imageUrl,
              },
            ]);
          }

          setIsLoading(false);
        }
      } catch (error) {
        logger.error({ error }, 'Face detection failed');
        if (!cancelled) {
          toast.error('Failed to detect faces. You can continue without character selection.');
          setIsLoading(false);
        }
      }
    };

    runDetection();

    return () => {
      cancelled = true;
    };
  }, [photos]);

  // Toggle character selection
  const handleToggleCharacter = useCallback((cluster: FaceCluster) => {
    setSelectedCharacters((prev) => {
      const existing = prev.find((c) => c.clusterId === cluster.id);
      if (existing) {
        // Deselect
        return prev.filter((c) => c.clusterId !== cluster.id);
      } else {
        // Select
        return [
          ...prev,
          {
            clusterId: cluster.id,
            name: '',
            sourceAssetId: cluster.bestFace.assetId,
            faceBounds: cluster.bestFace.box,
            imageUrl: cluster.bestFace.imageUrl,
          },
        ];
      }
    });
  }, []);

  // Update character name
  const handleNameChange = useCallback((clusterId: string, name: string) => {
    setSelectedCharacters((prev) =>
      prev.map((c) => (c.clusterId === clusterId ? { ...c, name } : c))
    );
  }, []);

  // Skip character selection
  const handleSkip = useCallback(() => {
    router.push(`/create/${bookId}/edit`);
  }, [router, bookId]);

  // Submit selected characters
  const handleContinue = useCallback(async () => {
    if (selectedCharacters.length === 0) {
      handleSkip();
      return;
    }

    // Validate all characters have names
    const unnamedCharacters = selectedCharacters.filter((c) => !c.name.trim());
    if (unnamedCharacters.length > 0) {
      toast.error('Please enter names for all selected characters');
      return;
    }

    setIsSubmitting(true);

    try {
      const token = await getToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      // Crop faces and prepare data
      const charactersWithCrops = await Promise.all(
        selectedCharacters.map(async (char) => {
          const croppedFaceDataUrl = await cropFaceFromImage(
            char.imageUrl,
            char.faceBounds
          );
          return {
            name: char.name.trim(),
            sourceAssetId: char.sourceAssetId,
            faceBounds: char.faceBounds,
            croppedFaceDataUrl,
          };
        })
      );

      // Save characters to API
      const response = await fetch(`/api/book/${bookId}/characters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ characters: charactersWithCrops }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save characters');
      }

      toast.success('Characters saved!');
      router.push(`/create/${bookId}/edit`);
    } catch (error) {
      logger.error({ error }, 'Failed to save characters');
      toast.error(
        `Failed to save characters: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedCharacters, getToken, bookId, router, handleSkip]);

  // Check if any selected characters are missing names
  const hasUnnamedCharacters = selectedCharacters.some((c) => !c.name.trim());

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-150px)] px-4">
        <div className="w-full max-w-xs space-y-6">
          <div className="flex flex-col items-center">
            <Loader2 className="w-12 h-12 text-[#F76C5E] animate-spin mb-4" />
            <h2 className="text-lg font-semibold text-gray-800 text-center">
              Finding faces in your photos
            </h2>
            <p className="text-sm text-gray-500 mt-1 text-center">
              {loadingMessage}
            </p>
          </div>

          <div className="space-y-2">
            <Progress value={loadingProgress} className="h-2" />
            <p className="text-xs text-gray-400 text-center">
              {loadingProgress}%
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* Header */}
      <div className="bg-white border-b px-4 py-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900">
          Who&apos;s in This Story?
        </h1>
        <p className="text-gray-600 mt-2 max-w-md mx-auto">
          Select the main characters and give them names. This helps us create a
          more personalized story!
        </p>
      </div>

      {/* Face Grid */}
      <div className="px-4 py-6 max-w-3xl mx-auto">
        <FaceGrid
          clusters={clusters}
          facePreviewUrls={facePreviewUrls}
          selectedCharacters={selectedCharacters}
          onToggleCharacter={handleToggleCharacter}
          onNameChange={handleNameChange}
        />
      </div>

      {/* Footer */}
      <CharacterConfirmFooter
        selectedCount={selectedCharacters.length}
        hasUnnamedCharacters={hasUnnamedCharacters}
        isSubmitting={isSubmitting}
        onSkip={handleSkip}
        onContinue={handleContinue}
      />
    </div>
  );
}

export default CharacterSelectionScreen;
