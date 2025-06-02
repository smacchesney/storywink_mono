import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { db as prisma } from '@/lib/db'; // Import shared instance as prisma for less code change
import logger from '@/lib/logger';
import { PageType } from '@prisma/client'; // Import PageType
import { getAuthenticatedUser } from '@/lib/db/ensureUser'; // Import the new helper

// --- DEBUG: Log environment variables before configuration ---
console.log("--- Cloudinary Env Vars Check ---");
console.log("CLOUDINARY_CLOUD_NAME:", process.env.CLOUDINARY_CLOUD_NAME);
console.log("CLOUDINARY_API_KEY:", process.env.CLOUDINARY_API_KEY ? 'SET' : 'NOT SET'); // Log SET/NOT SET for secrets
console.log("CLOUDINARY_API_SECRET:", process.env.CLOUDINARY_API_SECRET ? 'SET' : 'NOT SET');
console.log("-----------------------------------");
// --- End Debug Log ---

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
});

// Helper function to upload a buffer to Cloudinary
async function uploadToCloudinary(buffer: Buffer, options: object): Promise<any> {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(options, (error, result) => {
            if (error) {
                console.error("Cloudinary Upload Error:", error);
                return reject(error);
            }
            resolve(result);
        }).end(buffer);
    });
}

export async function POST(request: Request) {
    // Add this log to check the environment variable
    console.log('DATABASE_URL in /api/upload:', process.env.DATABASE_URL ? 'Loaded' : 'MISSING!');
    // Log the full URL - REMEMBER TO REDACT PASSWORD IF SHARING LOGS
    console.log('>>> DEBUG: Actual DATABASE_URL:', process.env.DATABASE_URL); 
    
    try {
        // Use the new helper to get authenticated user data
        const { clerkId, dbUser, primaryEmail } = await getAuthenticatedUser();
        console.log(">>> DEBUG: Authenticated userId for upload:", clerkId);
        logger.info({ clerkUserId: clerkId, dbUserId: dbUser.id, email: primaryEmail }, "User authentication completed in upload route.");

        const formData = await request.formData();
        const files = formData.getAll('files') as File[];
        const bookId = formData.get('bookId') as string | null; // <-- Get optional bookId

        if (!files || files.length === 0) {
            return NextResponse.json({ error: 'No files provided' }, { status: 400 });
        }

        const uploadedAssets = [];
        let bookPageCount = 0; // To track index for new pages if bookId provided
        
        // If bookId provided, fetch initial page count for indexing
        if (bookId) {
           // Verify user owns the book first - use dbUser.id for database queries
           const book = await prisma.book.findUnique({
               where: { id: bookId, userId: dbUser.id },
               select: { _count: { select: { pages: true } } } // Efficiently get page count
           });
           if (!book) {
               return NextResponse.json({ error: 'Book not found or permission denied' }, { status: 404 });
           }
           bookPageCount = book._count.pages;
        }

        for (const file of files) {
            // --- Validation (Add more as needed) ---
            if (file.size > 10 * 1024 * 1024) { // Example: 10MB limit
                 console.warn(`Skipping file ${file.name} due to size limit.`);
                 continue; // Skip this file or return error
            }
            if (!['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'].includes(file.type)) {
                 console.warn(`Skipping file ${file.name} due to invalid type ${file.type}.`);
                 continue; // Skip this file or return error
            }
            // --- End Validation ---

            const bytes = await file.arrayBuffer();
            const buffer = Buffer.from(bytes);

            // --- Upload to Cloudinary ---
            const cloudinaryResult = await uploadToCloudinary(buffer, {
                folder: `user_${dbUser.id}/uploads`, // Use database user ID for consistency
            });

            if (!cloudinaryResult || !cloudinaryResult.secure_url) {
                throw new Error(`Failed to upload ${file.name} to Cloudinary.`);
            }

            // --- Explicitly Test DB Connection --- 
            try {
              console.log(">>> DEBUG: Attempting explicit DB connection test...");
              await prisma.$connect(); // Try to establish connection
              // You could also perform a simple query:
              // await prisma.$queryRaw`SELECT 1`;
              console.log(">>> DEBUG: Explicit DB connection test successful!");
              await prisma.$disconnect(); // Disconnect after test
            } catch (connectionError) {
              console.error(">>> DEBUG: Explicit DB connection test FAILED:", connectionError);
              // Rethrow or handle as appropriate, maybe return a specific error response
              throw new Error("Database connection failed during upload process."); 
            }
            // --- End Explicit DB Connection Test ---

            // --- Transaction: Create Asset AND potentially Page --- 
            const createdData = await prisma.$transaction(async (tx) => {
                // Create Asset - use dbUser.id instead of clerkId
                const newAsset = await tx.asset.create({
                    data: {
                        userId: dbUser.id, // Use database user ID, not Clerk ID
                        publicId: cloudinaryResult.public_id, 
                        url: cloudinaryResult.secure_url,       
                        thumbnailUrl: cloudinary.url(cloudinaryResult.public_id, {
                            width: 200, height: 200, crop: 'fill', quality: 'auto', fetch_format: 'auto'
                        }),
                        fileType: file.type,                   
                        size: file.size,
                    },
                });

                // If bookId was provided, create Page record
                if (bookId) {
                    await tx.page.create({
                        data: {
                            bookId: bookId,
                            assetId: newAsset.id,
                            pageNumber: bookPageCount + 1, // Next page number
                            index: bookPageCount,       // Next index (0-based)
                            originalImageUrl: newAsset.thumbnailUrl || newAsset.url, // Use thumb or full url
                            pageType: PageType.SINGLE, // Default
                            isTitlePage: false, // New pages added are never title pages initially
                            // Text, generatedUrl, etc. are null by default
                        }
                    });
                    bookPageCount++; // Increment for the next potential file in this batch
                }
                
                // Return asset data needed by the frontend
                return {
                    id: newAsset.id,
                    thumbnailUrl: newAsset.thumbnailUrl,
                };
            });
            // --- End Transaction --- 

            uploadedAssets.push(createdData);
        }

        return NextResponse.json({ assets: uploadedAssets }, { status: 201 });

    } catch (error) {
        // Handle authentication errors specifically
        if (error instanceof Error && (
            error.message.includes('not authenticated') ||
            error.message.includes('ID mismatch') ||
            error.message.includes('primary email not found')
        )) {
            console.error('Authentication error in upload:', error.message);
            return NextResponse.json({ error: 'Unauthorized', details: error.message }, { status: 401 });
        }
        
        // Handle other errors
        console.error('Upload API Error:', error);
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        return NextResponse.json({ error: 'File upload failed', details: message }, { status: 500 });
    }
} 