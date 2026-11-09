-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "TaskStatus" ADD VALUE 'CLOSED';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "noTakerNoticeAt" TIMESTAMP(3),
ADD COLUMN     "silenceAlertAt" TIMESTAMP(3),
ADD COLUMN     "targetViewId" TEXT;

-- CreateIndex
CREATE INDEX "Task_targetViewId_idx" ON "Task"("targetViewId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_targetViewId_fkey" FOREIGN KEY ("targetViewId") REFERENCES "ProductView"("id") ON DELETE SET NULL ON UPDATE CASCADE;

