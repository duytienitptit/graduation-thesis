-- CreateEnum
CREATE TYPE "TaskMessageKind" AS ENUM ('TEXT', 'FILE', 'SAMPLE', 'FINAL');

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'DONE';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "agreedAt" TIMESTAMP(3),
ADD COLUMN     "agreedVersionId" TEXT,
ADD COLUMN     "backDescription" TEXT,
ADD COLUMN     "backFileId" TEXT,
ADD COLUMN     "doneAt" TIMESTAMP(3),
ADD COLUMN     "finalVersionId" TEXT;

-- CreateTable
CREATE TABLE "TaskMessage" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "kind" "TaskMessageKind" NOT NULL,
    "text" TEXT,
    "fileId" TEXT,
    "versionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskMessage_taskId_createdAt_idx" ON "TaskMessage"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_agreedVersionId_fkey" FOREIGN KEY ("agreedVersionId") REFERENCES "DesignVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_finalVersionId_fkey" FOREIGN KEY ("finalVersionId") REFERENCES "DesignVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_backFileId_fkey" FOREIGN KEY ("backFileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMessage" ADD CONSTRAINT "TaskMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMessage" ADD CONSTRAINT "TaskMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMessage" ADD CONSTRAINT "TaskMessage_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMessage" ADD CONSTRAINT "TaskMessage_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DesignVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

