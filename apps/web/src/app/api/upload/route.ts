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
    console.log(">>> DEBUG: Starting Cloudinary upload...");
    
    return new Promise((resolve, reject) => {
        // Add timeout to prevent hanging
        const timeout = setTimeout(() => {
            console.error(">>> DEBUG: Cloudinary upload timeout after 30 seconds");
            reject(new Error("Cloudinary upload timeout"));
        }, 30000);
        
        cloudinary.uploader.upload_stream(options, (error, result) => {
            clearTimeout(timeout);
            
            if (error) {
                console.error(">>> DEBUG: Cloudinary Upload Error:", error);
                return reject(error);
            }
            
            console.log(">>> DEBUG: Cloudinary upload successful, public_id:", result?.public_id);
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
            console.log(`Processing file: ${file.name}, type: ${file.type}, size: ${file.size}`);
            if (!['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'].includes(file.type)) {
                 console.warn(`Skipping file ${file.name} due to invalid type ${file.type}.`);
                 continue; // Skip this file or return error
            }
            // --- End Validation ---

            const bytes = await file.arrayBuffer();
            const buffer = Buffer.from(bytes);

            // --- Upload to Cloudinary ---
            let cloudinaryResult;
            try {
                console.log(`>>> DEBUG: About to upload ${file.name} to Cloudinary...`);
                cloudinaryResult = await uploadToCloudinary(buffer, {
                    folder: `user_${dbUser.id}/uploads`, // Use database user ID for consistency
                    resource_type: "auto", // Let Cloudinary detect the type
                });

                if (!cloudinaryResult || !cloudinaryResult.secure_url) {
                    throw new Error(`Failed to upload ${file.name} to Cloudinary.`);
                }
                console.log(`>>> DEBUG: Successfully uploaded ${file.name}, URL: ${cloudinaryResult.secure_url}`);
            } catch (cloudinaryError) {
                console.error(`>>> DEBUG: Cloudinary upload error for ${file.name}:`, cloudinaryError);
                throw new Error(`Failed to upload ${file.name} to Cloudinary: ${cloudinaryError instanceof Error ? cloudinaryError.message : 'Unknown error'}`);
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
            console.log(`>>> DEBUG: Starting database transaction for ${file.name}...`);
            try {
                const createdData = await prisma.$transaction(async (tx) => {
                    console.log(`>>> DEBUG: Creating asset record for ${file.name}...`);
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
                    console.log(`>>> DEBUG: Asset created with ID: ${newAsset.id}`);

                    // If bookId was provided, create Page record
                    if (bookId) {
                        console.log(`>>> DEBUG: Creating page record for book ${bookId}...`);
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
                        console.log(`>>> DEBUG: Page record created for book ${bookId}`);
                    }
                    
                    // Return asset data needed by the frontend
                    console.log(`>>> DEBUG: Transaction successful for ${file.name}`);
                    return {
                        id: newAsset.id,
                        thumbnailUrl: newAsset.thumbnailUrl,
                    };
                });
                console.log(`>>> DEBUG: Database transaction completed for ${file.name}`);
                
                uploadedAssets.push(createdData);
                console.log(`>>> DEBUG: Added asset to uploadedAssets array, total: ${uploadedAssets.length}`);
            } catch (dbError) {
                console.error(`>>> DEBUG: Database transaction failed for ${file.name}:`, dbError);
                throw new Error(`Database transaction failed for ${file.name}: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`);
            }
            // --- End Transaction --- 

        }
        
        console.log(`>>> DEBUG: Finished processing all files. Total uploaded: ${uploadedAssets.length}`);
        console.log(`>>> DEBUG: Returning response with ${uploadedAssets.length} assets`);

        // Return in the format expected by API client
        if (uploadedAssets.length === 1) {
            console.log(`>>> DEBUG: Returning single asset:`, uploadedAssets[0]);
            return NextResponse.json({ 
                success: true, 
                data: uploadedAssets[0] 
            }, { status: 201 });
        } else {
            // This shouldn't happen with current frontend implementation
            console.log(`>>> DEBUG: WARNING: Multiple files in single request (${uploadedAssets.length}), returning array format`);
            return NextResponse.json({ 
                success: true, 
                data: { assets: uploadedAssets } 
            }, { status: 201 });
        }

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