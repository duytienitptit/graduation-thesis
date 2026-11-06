-- CreateEnum
CREATE TYPE "DesignVersionSource" AS ENUM ('AI', 'DESIGNER');

-- CreateEnum
CREATE TYPE "AiJobKind" AS ENUM ('CREATE', 'EDIT');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "DesignVersion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "parentVersionId" TEXT,
    "fileId" TEXT NOT NULL,
    "source" "DesignVersionSource" NOT NULL,
    "prompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" "AiJobKind" NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'QUEUED',
    "prompt" TEXT NOT NULL,
    "editRequest" TEXT,
    "parentVersionId" TEXT,
    "referenceFileIds" TEXT[],
    "versionId" TEXT,
    "model" TEXT,
    "error" TEXT,
    "costUsd" DECIMAL(10,4),
    "durationMs" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignVersion_sessionId_idx" ON "DesignVersion"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AiJob_versionId_key" ON "AiJob"("versionId");

-- CreateIndex
CREATE INDEX "AiJob_customerId_createdAt_idx" ON "AiJob"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "AiJob_sessionId_status_idx" ON "AiJob"("sessionId", "status");

-- AddForeignKey
ALTER TABLE "DesignVersion" ADD CONSTRAINT "DesignVersion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignVersion" ADD CONSTRAINT "DesignVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "DesignVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignVersion" ADD CONSTRAINT "DesignVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DesignVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
