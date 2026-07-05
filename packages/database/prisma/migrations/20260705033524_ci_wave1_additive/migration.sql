-- CreateEnum
CREATE TYPE "PageSource" AS ENUM ('PHOTO', 'BRIDGE');

-- AlterTable
ALTER TABLE "Book" ADD COLUMN     "characterReferences" JSONB,
ADD COLUMN     "firstViewedAt" TIMESTAMP(3),
ADD COLUMN     "generationPhase" TEXT;

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "bridgeScene" JSONB,
ADD COLUMN     "lastRenderModel" TEXT,
ADD COLUMN     "lastRenderProvider" TEXT,
ADD COLUMN     "source" "PageSource" NOT NULL DEFAULT 'PHOTO';

-- CreateTable
CREATE TABLE "IllustrationQcResult" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "pageId" TEXT,
    "target" TEXT NOT NULL DEFAULT 'page',
    "qcRound" INTEGER NOT NULL,
    "charScore" DOUBLE PRECISION,
    "styleScore" DOUBLE PRECISION,
    "overallScore" DOUBLE PRECISION,
    "passed" BOOLEAN NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "hadSheet" BOOLEAN NOT NULL DEFAULT false,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IllustrationQcResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "bookId" TEXT,
    "name" TEXT NOT NULL,
    "props" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IllustrationQcResult_bookId_idx" ON "IllustrationQcResult"("bookId");

-- CreateIndex
CREATE INDEX "IllustrationQcResult_createdAt_idx" ON "IllustrationQcResult"("createdAt");

-- CreateIndex
CREATE INDEX "AppEvent_name_createdAt_idx" ON "AppEvent"("name", "createdAt");

-- CreateIndex
CREATE INDEX "AppEvent_bookId_idx" ON "AppEvent"("bookId");

-- AddForeignKey
ALTER TABLE "IllustrationQcResult" ADD CONSTRAINT "IllustrationQcResult_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
