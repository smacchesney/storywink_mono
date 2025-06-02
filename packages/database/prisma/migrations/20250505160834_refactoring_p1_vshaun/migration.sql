-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "coverAssetId" TEXT;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "index" INTEGER NOT NULL DEFAULT 0;
