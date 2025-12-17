import * as faceapi from '@vladmandic/face-api';

// Types
export interface DetectedFace {
  id: string;
  assetId: string;
  imageUrl: string;
  box: { x: number; y: number; width: number; height: number };
  score: number;
  descriptor: Float32Array; // 128-dim face embedding for clustering
}

export interface FaceCluster {
  id: string;
  faces: DetectedFace[];
  bestFace: DetectedFace; // Highest quality face in cluster
  frequency: number; // Number of photos this person appears in
}

// Module state
let modelsLoaded = false;
let modelsLoading = false;

/**
 * Load face-api.js models (call once on app init)
 */
export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;

  // Prevent multiple concurrent loads
  if (modelsLoading) {
    // Wait for existing load to complete
    while (modelsLoading) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return;
  }

  modelsLoading = true;

  try {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
    ]);

    modelsLoaded = true;
  } finally {
    modelsLoading = false;
  }
}

/**
 * Check if models are loaded
 */
export function areModelsLoaded(): boolean {
  return modelsLoaded;
}

/**
 * Detect all faces in a single image
 */
export async function detectFacesInImage(
  imageUrl: string,
  assetId: string
): Promise<DetectedFace[]> {
  // Load image into HTML element
  const img = await faceapi.fetchImage(imageUrl);

  // Detect faces with landmarks and descriptors
  const detections = await faceapi
    .detectAllFaces(img)
    .withFaceLandmarks()
    .withFaceDescriptors();

  // Convert to our format
  return detections
    .filter((d) => {
      // Filter out tiny faces (< 50x50 pixels)
      const { width, height } = d.detection.box;
      return width >= 50 && height >= 50;
    })
    .map((d, i) => ({
      id: `${assetId}-face-${i}`,
      assetId,
      imageUrl,
      box: {
        x: d.detection.box.x,
        y: d.detection.box.y,
        width: d.detection.box.width,
        height: d.detection.box.height,
      },
      score: d.detection.score,
      descriptor: d.descriptor,
    }));
}

/**
 * Cluster faces by similarity (same person = one cluster)
 * Uses Euclidean distance on 128-dim descriptors
 */
export function clusterFaces(allFaces: DetectedFace[]): FaceCluster[] {
  const THRESHOLD = 0.6; // Lower = stricter matching
  const clusters: FaceCluster[] = [];

  for (const face of allFaces) {
    // Find existing cluster this face belongs to
    let foundCluster: FaceCluster | null = null;

    for (const cluster of clusters) {
      const distance = faceapi.euclideanDistance(
        face.descriptor,
        cluster.bestFace.descriptor
      );

      if (distance < THRESHOLD) {
        foundCluster = cluster;
        break;
      }
    }

    if (foundCluster) {
      // Add to existing cluster
      foundCluster.faces.push(face);
      foundCluster.frequency = new Set(
        foundCluster.faces.map((f) => f.assetId)
      ).size;

      // Update best face if this one is better
      const currentBestQuality =
        foundCluster.bestFace.score *
        foundCluster.bestFace.box.width *
        foundCluster.bestFace.box.height;
      const newQuality = face.score * face.box.width * face.box.height;

      if (newQuality > currentBestQuality) {
        foundCluster.bestFace = face;
      }
    } else {
      // Create new cluster
      clusters.push({
        id: `cluster-${clusters.length}`,
        faces: [face],
        bestFace: face,
        frequency: 1,
      });
    }
  }

  // Sort by frequency (most common person first)
  return clusters.sort((a, b) => b.frequency - a.frequency);
}

/**
 * Filter clusters to only show "real" characters
 * - Must appear in 2+ photos OR have high confidence (>0.9)
 */
export function getDisplayableClusters(clusters: FaceCluster[]): FaceCluster[] {
  return clusters.filter(
    (cluster) => cluster.frequency >= 2 || cluster.bestFace.score > 0.9
  );
}

/**
 * Main entry: Process all uploaded photos and return clustered faces
 */
export async function detectAndClusterFaces(
  photos: Array<{ assetId: string; url: string }>,
  onProgress?: (completed: number, total: number) => void
): Promise<FaceCluster[]> {
  await loadFaceModels();

  // Detect faces in all photos with progress reporting
  const allFaces: DetectedFace[] = [];

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    try {
      const faces = await detectFacesInImage(photo.url, photo.assetId);
      allFaces.push(...faces);
    } catch (error) {
      console.warn(`Failed to detect faces in ${photo.assetId}:`, error);
    }
    onProgress?.(i + 1, photos.length);
  }

  // Cluster faces
  const clusters = clusterFaces(allFaces);

  return getDisplayableClusters(clusters);
}

/**
 * Crop a face from an image and return as data URL
 * Used when saving characters
 */
export async function cropFaceFromImage(
  imageUrl: string,
  box: { x: number; y: number; width: number; height: number },
  padding = 0.3 // 30% padding around face for better context
): Promise<string> {
  const img = await faceapi.fetchImage(imageUrl);

  // Calculate padded box
  const padX = box.width * padding;
  const padY = box.height * padding;

  const cropX = Math.max(0, box.x - padX);
  const cropY = Math.max(0, box.y - padY);
  const cropW = Math.min(img.width - cropX, box.width + padX * 2);
  const cropH = Math.min(img.height - cropY, box.height + padY * 2);

  // Create canvas and crop
  const canvas = document.createElement('canvas');
  canvas.width = cropW;
  canvas.height = cropH;

  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Generate a preview of a cropped face (smaller, for UI display)
 */
export async function generateFacePreview(
  imageUrl: string,
  box: { x: number; y: number; width: number; height: number },
  targetSize = 200 // Output size in pixels
): Promise<string> {
  const dataUrl = await cropFaceFromImage(imageUrl, box, 0.3);

  // Resize to target size
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;

      const ctx = canvas.getContext('2d')!;
      // Draw centered and cropped to square
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;

      ctx.drawImage(img, sx, sy, size, size, 0, 0, targetSize, targetSize);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUrl;
  });
}
