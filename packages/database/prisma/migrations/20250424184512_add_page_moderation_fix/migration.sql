-- AlterEnum
ALTER TYPE "BookStatus" ADD VALUE 'PARTIAL';

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "moderationReason" TEXT,
ADD COLUMN     "moderationStatus" TEXT NOT NULL DEFAULT 'PENDING';
