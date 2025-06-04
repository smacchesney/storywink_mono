import cloudinary from "./cloudinary.js";
import logger from "./logger.js";

interface UploadOptions {
  folder?: string;
  public_id?: string;
  // Add other Cloudinary upload options as needed
  // e.g., tags?: string[]; context?: Record<string, string>;
}

interface UploadResult {
  public_id: string;
  version: number;
  signature: string;
  width: number;
  height: number;
  format: string;
  resource_type: string;
  created_at: string;
  tags: string[];
  bytes: number;
  type: string;
  etag: string;
  placeholder: boolean;
  url: string;
  secure_url: string;
  // Add other fields from Cloudinary response if needed
}

/**
 * Uploads an image file to Cloudinary.
 * @param file - The file to upload (e.g., base64 data URI or buffer).
 * @param options - Optional configuration for the upload (folder, public_id, etc.).
 * @returns A promise resolving to the Cloudinary upload response.
 */
export async function uploadImage(
  file: string | Buffer,
  options: UploadOptions = {},
): Promise<UploadResult> {
  try {
    const result = await cloudinary.uploader.upload(
      // Cloudinary type definition expects string for file path/URL/base64
      // but Buffer might be common in Node.js environments. Handle appropriately.
      // For simplicity, assuming `file` is a base64 string or URL for now.
      // If using Buffers, might need conversion or different upload method (e.g., upload_stream).
      file as string,
      {
        resource_type: "image", // Explicitly set resource type
        ...options,
      },
    );
    logger.info(
      { publicId: result.public_id, folder: options.folder },
      "Image uploaded successfully to Cloudinary",
    );
    return result as UploadResult; // Cast to our defined interface
  } catch (error) {
    logger.error({ error, options }, "Cloudinary image upload failed");
    // Re-throw or handle error appropriately based on application needs
    throw error;
  }
}

// Optional: Add functions for deleting, renaming, etc. as needed
// export async function deleteImage(publicId: string) { ... }
