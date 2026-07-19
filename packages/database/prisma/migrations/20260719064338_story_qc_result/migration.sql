-- CreateTable
CREATE TABLE "StoryQcResult" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "bookType" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "scores" JSONB NOT NULL,
    "feedback" TEXT,
    "targetedRewrites" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryQcResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoryQcResult_bookId_idx" ON "StoryQcResult"("bookId");

-- CreateIndex
CREATE INDEX "StoryQcResult_createdAt_idx" ON "StoryQcResult"("createdAt");

-- AddForeignKey
ALTER TABLE "StoryQcResult" ADD CONSTRAINT "StoryQcResult_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;
