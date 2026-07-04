-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "captureQuestions" JSONB,
ADD COLUMN     "eventSummary" TEXT;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "analysis" JSONB;

-- CreateIndex
CREATE INDEX "Book_status_idx" ON "Book"("status");
