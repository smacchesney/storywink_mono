-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "isTitlePage" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Page_assetId_idx" ON "Page"("assetId");

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
