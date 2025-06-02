import { v2 as cloudinary } from "cloudinary";
import logger from "./logger"; // Import the logger we created

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  const missingVars = [
    !cloudName && "CLOUDINARY_CLOUD_NAME",
    !apiKey && "CLOUDINARY_API_KEY",
    !apiSecret && "CLOUDINARY_API_SECRET",
  ]
    .filter(Boolean)
    .join(", ");

  logger.error(`Missing Cloudinary environment variables: ${missingVars}`);
  // In a real application, you might want to throw an error here
  // or handle it gracefully depending on whether Cloudinary is critical at startup.
  // For now, we just log the error.
  // throw new Error(`Missing Cloudinary environment variables: ${missingVars}`);
} else {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true, // Use https
  });
  logger.info("Cloudinary configured successfully.");
}

export default cloudinary;

interface SignedUrlOptions {
  version?: string | number;
  // Add other transformation options if needed for the signed URL
  // e.g., width?: number; height?: number; crop?: string; quality?: string | number;
}

/**
 * Generates a signed Cloudinary URL for accessing a private resource.
 * Note: Requires 'Signed media delivery' to be enabled in Cloudinary settings.
 * @param publicId - The public ID of the asset.
 * @param options - Optional configuration for transformations in the signed URL.
 * @returns A signed URL string with a default expiration (e.g., 1 hour).
 */
export function getSignedImageUrl(
  publicId: string,
  options: SignedUrlOptions = {},
): string {
  // The `sign_url: true` option automatically handles signing
  // Default expiration is 1 hour, can be customized via `expires_at`
  try {
    const signedUrl = cloudinary.url(publicId, {
      ...options,
      sign_url: true,
      secure: true, // Ensure HTTPS
      resource_type: "image", // Specify resource type
      // Example: Custom expiration (e.g., 10 minutes from now)
      // expires_at: Math.floor(Date.now() / 1000) + 600,
    });
    logger.debug({ publicId }, "Generated signed Cloudinary URL");
    return signedUrl;
  } catch (error) {
    logger.error(
      { error, publicId },
      "Failed to generate signed Cloudinary URL",
    );
    // Depending on requirements, return a placeholder URL or re-throw
    // For now, re-throwing to indicate failure clearly
    throw error;
  }
}

// If direct import is desired: export { cloudinary, getSignedImageUrl };
