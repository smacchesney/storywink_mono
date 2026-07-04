import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import logger from '@/lib/logger';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * POST /api/upload/signature
 *
 * Issues a short-lived signature for direct browser→Cloudinary uploads.
 * This replaces the unsigned upload preset: only authenticated users can
 * obtain a signature, and it pins the upload to their own folder, so the
 * storage quota can no longer be abused anonymously.
 *
 * The client sends exactly the signed params (folder, timestamp) plus
 * file/api_key/signature to https://api.cloudinary.com/v1_1/<cloud>/image/upload.
 * Cloudinary rejects a signature older than 1 hour.
 */
export async function POST() {
  try {
    const { dbUser } = await getAuthenticatedUser();

    if (!process.env.CLOUDINARY_API_SECRET || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_CLOUD_NAME) {
      logger.error('Cloudinary credentials not configured for signed uploads');
      return NextResponse.json({ error: 'Upload service not configured' }, { status: 500 });
    }

    const timestamp = Math.round(Date.now() / 1000);
    const folder = `user_${dbUser.id}/uploads`;

    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      process.env.CLOUDINARY_API_SECRET
    );

    return NextResponse.json({
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      timestamp,
      folder,
      signature,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('not authenticated') ||
        error.message.includes('ID mismatch') ||
        error.message.includes('primary email not found'))
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    logger.error({ error }, 'Failed to issue upload signature');
    return NextResponse.json({ error: 'Failed to prepare upload' }, { status: 500 });
  }
}
