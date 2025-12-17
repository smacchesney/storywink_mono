import * as faceapi from '@vladmandic/face-api';

// Configuration
const CONFIG = {
  // Clustering thresholds (euclidean distance)
  DISTANCE_THRESHOLD: 0.5, // Was 0.6 - more lenient for children's variable expressions
  MERGE_THRESHOLD: 0.55, // For post-clustering merge pass

  // Detection settings
  MIN_FACE_SIZE: 30, // Was 50 - catch smaller faces in group shots
  MIN_CONFIDENCE: 0.5, // Detection confidence threshold
  MAX_IMAGE_DIMENSION: 1920, // Resize large images for better detection

  // Filtering
  MIN_FREQUENCY_FOR_DISPLAY: 2, // Must appear in 2+ photos
  HIGH_CONFIDENCE_SINGLE: 0.9, // OR single photo with high confidence
};

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
 * Resize image if too large for optimal face detection
 * Returns a canvas element that can be used for detection
 */
function resizeImageForDetection(img: HTMLImageElement): HTMLCanvasElement | HTMLImageElement {
  const maxDim = CONFIG.MAX_IMAGE_DIMENSION;
  const { width, height } = img;

  // If image is small enough, return as-is
  if (width <= maxDim && height <= maxDim) {
    return img;
  }

  // Calculate new dimensions maintaining aspect ratio
  const scale = Math.min(maxDim / width, maxDim / height);
  const newWidth = Math.round(width * scale);
  const newHeight = Math.round(height * scale);

  console.log(
    `[FaceDetection] Resizing image from ${width}x${height} to ${newWidth}x${newHeight}`
  );

  // Create canvas and draw resized image
  const canvas = document.createElement('canvas');
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, newWidth, newHeight);

  return canvas;
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
  const originalWidth = img.width;
  const originalHeight = img.height;

  // Resize if needed for better detection
  const inputImage = resizeImageForDetection(img);
  const scale =
    inputImage instanceof HTMLCanvasElement
      ? originalWidth / inputImage.width
      : 1;

  // Detection options with lower confidence threshold
  const options = new faceapi.SsdMobilenetv1Options({
    minConfidence: CONFIG.MIN_CONFIDENCE,
  });

  // Detect faces with landmarks and descriptors
  const detections = await faceapi
    .detectAllFaces(inputImage, options)
    .withFaceLandmarks()
    .withFaceDescriptors();

  // Filter and convert to our format
  const filtered = detections.filter((d) => {
    // Filter out tiny faces (< MIN_FACE_SIZE pixels) - using original image coordinates
    const { width, height } = d.detection.box;
    const originalBoxWidth = width * scale;
    const originalBoxHeight = height * scale;
    return (
      originalBoxWidth >= CONFIG.MIN_FACE_SIZE &&
      originalBoxHeight >= CONFIG.MIN_FACE_SIZE
    );
  });

  console.log(
    `[FaceDetection] Photo ${assetId}: detected ${detections.length} faces, kept ${filtered.length} after size filter (${originalWidth}x${originalHeight})`
  );

  return filtered.map((d, i) => ({
    id: `${assetId}-face-${i}`,
    assetId,
    imageUrl,
    // Scale bounding box back to original image coordinates
    box: {
      x: d.detection.box.x * scale,
      y: d.detection.box.y * scale,
      width: d.detection.box.width * scale,
      height: d.detection.box.height * scale,
    },
    score: d.detection.score,
    descriptor: d.descriptor,
  }));
}

/**
 * Calculate centroid (average) descriptor for a cluster
 */
function calculateCentroid(faces: DetectedFace[]): Float32Array {
  const centroid = new Float32Array(128).fill(0);
  for (const face of faces) {
    for (let i = 0; i < 128; i++) {
      centroid[i] += face.descriptor[i];
    }
  }
  for (let i = 0; i < 128; i++) {
    centroid[i] /= faces.length;
  }
  return centroid;
}

/**
 * Find minimum distance from a face to any face in a cluster
 * This is better than comparing to bestFace only because poses/expressions vary
 */
function minDistanceToCluster(
  face: DetectedFace,
  cluster: FaceCluster
): number {
  let minDistance = Infinity;
  for (const clusterFace of cluster.faces) {
    const d = faceapi.euclideanDistance(face.descriptor, clusterFace.descriptor);
    if (d < minDistance) {
      minDistance = d;
    }
  }
  return minDistance;
}

/**
 * Merge clusters that have similar centroids
 * This catches cases where the same person ended up in different clusters
 */
function mergeSimilarClusters(clusters: FaceCluster[]): FaceCluster[] {
  if (clusters.length <= 1) return clusters;

  const merged: FaceCluster[] = [];
  const usedIndices = new Set<number>();

  for (let i = 0; i < clusters.length; i++) {
    if (usedIndices.has(i)) continue;

    let currentCluster = { ...clusters[i], faces: [...clusters[i].faces] };
    usedIndices.add(i);

    // Try to merge with other clusters
    for (let j = i + 1; j < clusters.length; j++) {
      if (usedIndices.has(j)) continue;

      const centroid1 = calculateCentroid(currentCluster.faces);
      const centroid2 = calculateCentroid(clusters[j].faces);
      const distance = faceapi.euclideanDistance(centroid1, centroid2);

      if (distance < CONFIG.MERGE_THRESHOLD) {
        console.log(
          `[FaceDetection] Merging cluster ${currentCluster.id} with ${clusters[j].id} (centroid distance: ${distance.toFixed(3)})`
        );

        // Merge faces
        currentCluster.faces.push(...clusters[j].faces);
        currentCluster.frequency = new Set(
          currentCluster.faces.map((f) => f.assetId)
        ).size;

        // Update best face
        for (const face of clusters[j].faces) {
          const currentBestQuality =
            currentCluster.bestFace.score *
            currentCluster.bestFace.box.width *
            currentCluster.bestFace.box.height;
          const newQuality = face.score * face.box.width * face.box.height;
          if (newQuality > currentBestQuality) {
            currentCluster.bestFace = face;
          }
        }

        usedIndices.add(j);
      }
    }

    merged.push(currentCluster);
  }

  // Re-sort by frequency
  return merged.sort((a, b) => b.frequency - a.frequency);
}

/**
 * Cluster faces by similarity (same person = one cluster)
 * Uses Euclidean distance on 128-dim descriptors
 */
export function clusterFaces(allFaces: DetectedFace[]): FaceCluster[] {
  console.log(`[FaceDetection] Clustering ${allFaces.length} total faces...`);
  const clusters: FaceCluster[] = [];

  for (const face of allFaces) {
    // Find existing cluster this face belongs to
    // Compare against ALL faces in cluster, not just bestFace
    let foundCluster: FaceCluster | null = null;
    let bestMatchDistance = Infinity;

    for (const cluster of clusters) {
      const distance = minDistanceToCluster(face, cluster);

      if (distance < CONFIG.DISTANCE_THRESHOLD && distance < bestMatchDistance) {
        foundCluster = cluster;
        bestMatchDistance = distance;
      }
    }

    console.log(
      `[FaceDetection] Face from ${face.assetId}: best match distance=${bestMatchDistance.toFixed(3)}, matched=${foundCluster ? 'yes' : 'no'}`
    );

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

  console.log(`[FaceDetection] Initial clustering: ${clusters.length} clusters`);
  clusters.forEach((c) =>
    console.log(
      `  - Cluster ${c.id}: ${c.faces.length} faces from ${c.frequency} photos`
    )
  );

  // Post-processing: merge clusters with similar centroids
  const mergedClusters = mergeSimilarClusters(clusters);

  console.log(`[FaceDetection] After merge pass: ${mergedClusters.length} clusters`);
  mergedClusters.forEach((c) =>
    console.log(
      `  - Cluster ${c.id}: ${c.faces.length} faces from ${c.frequency} photos`
    )
  );

  return mergedClusters;
}

/**
 * Filter clusters to only show "real" characters
 * - Must appear in 2+ photos OR have high confidence (>0.9)
 */
export function getDisplayableClusters(clusters: FaceCluster[]): FaceCluster[] {
  return clusters.filter(
    (cluster) =>
      cluster.frequency >= CONFIG.MIN_FREQUENCY_FOR_DISPLAY ||
      cluster.bestFace.score > CONFIG.HIGH_CONFIDENCE_SINGLE
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
