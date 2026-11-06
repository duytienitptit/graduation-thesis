-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('WAITING', 'ASSIGNED');

-- AlterEnum
ALTER TYPE "DesignSessionStatus" ADD VALUE 'DESIGNER';

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "referenceVersionId" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'WAITING',
    "designerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskNotice" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "designerId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "externalId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_status_createdAt_idx" ON "Task"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Task_sessionId_idx" ON "Task"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskNotice_taskId_designerId_dayKey_key" ON "TaskNotice"("taskId", "designerId", "dayKey");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_referenceVersionId_fkey" FOREIGN KEY ("referenceVersionId") REFERENCES "DesignVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "DesignerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskNotice" ADD CONSTRAINT "TaskNotice_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskNotice" ADD CONSTRAINT "TaskNotice_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "DesignerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
