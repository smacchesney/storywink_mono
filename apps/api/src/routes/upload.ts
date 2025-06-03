import { Router } from "express";
import { requireAuth } from "@clerk/express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import prisma from "../database/index.js";
import {
  ensureDbUser,
  AuthenticatedRequest,
} from "../middleware/ensureDbUser.js";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.mimetype)) {
      cb(new Error("Invalid file type. Only JPEG, PNG, and WebP are allowed."));
      return;
    }
    cb(null, true);
  },
});

export const uploadRouter = Router();

// Apply auth middleware to all routes
uploadRouter.use(requireAuth());
uploadRouter.use(ensureDbUser);

// POST /api/upload - Upload a file
uploadRouter.post(
  "/",
  upload.single("file"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.dbUser!.id;

      if (!req.file) {
        res.status(400).json({
          success: false,
          error: "No file provided",
        });
        return;
      }

      // Upload to Cloudinary
      const uploadPromise = new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: `storywink/${userId}`,
            resource_type: "image",
            transformation: [
              { width: 1024, height: 1024, crop: "limit" },
              { quality: "auto:good" },
            ],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          },
        );

        uploadStream.end(req.file!.buffer);
      });

      const result = (await uploadPromise) as any;

      // Generate thumbnail
      const thumbnailUrl = cloudinary.url(result.public_id, {
        width: 300,
        height: 300,
        crop: "fill",
        quality: "auto:low",
      });

      // Save to database
      const asset = await prisma.asset.create({
        data: {
          userId,
          url: result.secure_url,
          thumbnailUrl,
          publicId: result.public_id,
          fileType: result.format,
          size: result.bytes,
        },
      });

      res.json({
        success: true,
        data: asset,
      });
    } catch (error) {
      next(error);
    }
  },
);
