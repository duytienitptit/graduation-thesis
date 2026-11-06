-- AlterEnum
ALTER TYPE "AiJobKind" ADD VALUE 'VIEW';

-- AlterTable
ALTER TABLE "AiJob" ADD COLUMN     "viewId" TEXT;

-- CreateIndex
CREATE INDEX "AiJob_viewId_idx" ON "AiJob"("viewId");

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "ProductView"("id") ON DELETE SET NULL ON UPDATE CASCADE;
