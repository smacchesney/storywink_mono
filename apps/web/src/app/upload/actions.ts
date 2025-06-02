"use server";

import { auth } from "@clerk/nextjs/server";
import logger from "@/lib/logger";
import { uploadImage } from "@/lib/imageUpload";
import { db as prisma } from "@/lib/db";

// Basic validation types/limits (can be refined)
const ACCEPTED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

interface UploadFileParams {
  fileName: string;
  fileType: string;
  fileSize: number;
  fileDataUrl: string; // Base64 encoded data URL (e.g., "data:image/png;base64,...")
  // Optional: folder or other metadata
  folder?: string; 
}

interface UploadResult {
  success: boolean;
  message?: string;
  assetId?: string; // ID of the created Asset record in our DB
  cloudinaryUrl?: string; // URL from Cloudinary
  publicId?: string; // Public ID from Cloudinary
}

export async function handleImageUpload(params: UploadFileParams): Promise<UploadResult> {
  const { userId } = await auth();
  const { fileName, fileType, fileSize, fileDataUrl, folder } = params;

  if (!userId) {
    logger.error({ fileName }, "Upload attempt without authentication.");
    return { success: false, message: "Authentication required." };
  }

  logger.info({ userId, fileName, fileType, fileSize, folder }, "Received upload request.");

  // --- Server-side Validation ---
  // 1. File Type
  if (!ACCEPTED_FILE_TYPES.includes(fileType)) {
     logger.warn({ userId, fileName, fileType }, "Upload rejected: Invalid file type.");
     return { success: false, message: `Invalid file type: ${fileType}. Accepted types: ${ACCEPTED_FILE_TYPES.join(', ')}` };
  }

  // 2. File Size (checking size passed from client - Cloudinary might re-check)
   if (fileSize > MAX_FILE_SIZE_BYTES) {
     logger.warn({ userId, fileName, fileSize }, "Upload rejected: File size exceeds limit.");
     return { success: false, message: `File size exceeds ${MAX_FILE_SIZE_MB}MB limit.` };
  }
  
  // --- Cloudinary Upload & DB Record ---
  try {
    logger.info({ userId, fileName }, "Attempting Cloudinary upload...");
    const cloudinaryResult = await uploadImage(fileDataUrl, { 
      folder: folder ?? `user_${userId}/uploads`,
    });
    logger.info({ userId, publicId: cloudinaryResult.public_id }, "Cloudinary upload successful.");

    // --- Generate Thumbnail URL ---
    // Example transformation: fill crop, 200px width, auto quality/format
    const transformation = "c_fill,w_200,q_auto,f_auto"; 
    // Insert transformation into the URL
    const thumbnailUrl = cloudinaryResult.secure_url.replace(
      '/upload/', 
      `/upload/${transformation}/`
    );
    logger.info({ userId, thumbnailUrl }, "Thumbnail URL generated.");

    // Create Asset record in Prisma DB using actual Cloudinary result
    const asset = await prisma.asset.create({
      data: {
        userId: userId,
        url: cloudinaryResult.secure_url,
        publicId: cloudinaryResult.public_id,
        fileType: fileType,
        size: cloudinaryResult.bytes,
        thumbnailUrl: thumbnailUrl, // Add the generated thumbnail URL
      },
      select: { id: true }
    });
    
    logger.info({ userId, assetId: asset.id, publicId: cloudinaryResult.public_id }, "Asset record created in database.");

    return { 
      success: true, 
      assetId: asset.id, 
      cloudinaryUrl: cloudinaryResult.secure_url,
      publicId: cloudinaryResult.public_id,
      message: "File uploaded successfully."
    };

  } catch (error: any) {
    logger.error({ userId, fileName, error }, "Server error during upload process.");
    const message = error?.message ?? "An error occurred during upload. Please try again.";
    return { success: false, message };
  }
} 