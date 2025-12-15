/**
 * Dropbox integration for uploading Lulu PDFs.
 *
 * Lulu PDFs are stored in Dropbox instead of Cloudinary to avoid
 * the 10MB upload limit. Files are organized by bookId and made
 * publicly accessible for Lulu to fetch.
 */

import { Dropbox, DropboxAuth } from 'dropbox';

const appKey = process.env.DROPBOX_APP_KEY;
const appSecret = process.env.DROPBOX_APP_SECRET;
const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;

// Lazy-initialized Dropbox client
let _dbx: Dropbox | null = null;

/**
 * Get or create the Dropbox client.
 * Uses refresh token for automatic token renewal (no 4-hour expiration issues).
 */
function getDropboxClient(): Dropbox {
  if (_dbx) return _dbx;

  if (!appKey || !appSecret || !refreshToken) {
    throw new Error('Dropbox not configured: Missing DROPBOX_APP_KEY, DROPBOX_APP_SECRET, or DROPBOX_REFRESH_TOKEN');
  }

  // Create auth instance with refresh token - automatically handles token refresh
  const dbxAuth = new DropboxAuth({
    clientId: appKey,
    clientSecret: appSecret,
    refreshToken: refreshToken,
    fetch: fetch,
  });

  // Create Dropbox client with auth
  _dbx = new Dropbox({ auth: dbxAuth, fetch: fetch });
  return _dbx;
}

/**
 * Upload a PDF buffer to Dropbox and return a public download URL.
 *
 * @param buffer - PDF file buffer
 * @param bookId - Book ID for folder organization
 * @param filename - 'interior.pdf' or 'cover.pdf'
 * @returns Object with public URL (with ?dl=1 suffix) and Dropbox path
 */
export async function uploadPdfToDropbox(
  buffer: Buffer,
  bookId: string,
  filename: 'interior.pdf' | 'cover.pdf'
): Promise<{ url: string; path: string }> {
  const dbx = getDropboxClient();

  const dropboxPath = `/Apps/Storywink/lulu-prints/${bookId}/${filename}`;

  console.log(`[Dropbox] Uploading ${filename} for book ${bookId}...`);

  // Upload file (filesUpload handles files < 150MB, our PDFs are < 50MB)
  const uploadResult = await dbx.filesUpload({
    path: dropboxPath,
    contents: buffer,
    mode: { '.tag': 'overwrite' },
    autorename: false,
  });

  // Create or get shared link
  let sharedUrl: string;

  try {
    const shareResult = await dbx.sharingCreateSharedLinkWithSettings({
      path: dropboxPath,
      settings: {
        requested_visibility: { '.tag': 'public' },
      },
    });
    sharedUrl = shareResult.result.url;
  } catch (error: unknown) {
    // If link already exists, fetch it
    const errorObj = error as { error?: { error_summary?: string } };
    if (errorObj?.error?.error_summary?.includes('shared_link_already_exists')) {
      console.log(`[Dropbox] Shared link already exists for ${dropboxPath}, fetching existing link...`);
      const listResult = await dbx.sharingListSharedLinks({
        path: dropboxPath,
        direct_only: true,
      });
      if (listResult.result.links.length > 0) {
        sharedUrl = listResult.result.links[0].url;
      } else {
        throw new Error('Shared link exists but could not be retrieved');
      }
    } else {
      throw error;
    }
  }

  // Convert to direct download URL for Lulu
  // - Replace dl=0 with dl=1 (can appear as &dl=0 not just ?dl=0)
  // - Add raw=1 to ensure Dropbox serves raw file content, not HTML preview
  const directDownloadUrl = sharedUrl.replace(/dl=0/, 'dl=1') + '&raw=1';

  console.log(`[Dropbox] Successfully uploaded ${filename} for book ${bookId}`);
  console.log(`[Dropbox] URL: ${directDownloadUrl}`);

  return {
    url: directDownloadUrl,
    path: uploadResult.result.path_display || dropboxPath,
  };
}
