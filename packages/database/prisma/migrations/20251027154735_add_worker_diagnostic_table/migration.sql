-- CreateTable
CREATE TABLE "WorkerDiagnostic" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "attemptNum" INTEGER NOT NULL,
    "maxAttempts" INTEGER NOT NULL,
    "bookId" TEXT,
    "pageId" TEXT,
    "pageNumber" INTEGER,
    "errorType" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "errorStage" TEXT NOT NULL,
    "styleKey" TEXT,
    "styleExists" BOOLEAN,
    "hasReferenceImageUrl" BOOLEAN,
    "referenceImageUrlType" TEXT,
    "referenceImageUrlValue" TEXT,
    "availableStyleKeys" TEXT,
    "instanceId" TEXT NOT NULL,
    "processId" INTEGER NOT NULL,
    "hostname" TEXT,
    "railwayCommit" TEXT,
    "nodeVersion" TEXT,

    CONSTRAINT "WorkerDiagnostic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerDiagnostic_jobId_idx" ON "WorkerDiagnostic"("jobId");

-- CreateIndex
CREATE INDEX "WorkerDiagnostic_bookId_idx" ON "WorkerDiagnostic"("bookId");

-- CreateIndex
CREATE INDEX "WorkerDiagnostic_pageId_idx" ON "WorkerDiagnostic"("pageId");

-- CreateIndex
CREATE INDEX "WorkerDiagnostic_errorType_idx" ON "WorkerDiagnostic"("errorType");

-- CreateIndex
CREATE INDEX "WorkerDiagnostic_createdAt_idx" ON "WorkerDiagnostic"("createdAt");
