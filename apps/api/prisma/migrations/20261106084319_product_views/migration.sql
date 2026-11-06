-- CreateEnum
CREATE TYPE "ProductViewType" AS ENUM ('FRONT', 'BACK', 'CLOSE_UP', 'EXTRA');

-- CreateEnum
CREATE TYPE "ProductViewStatus" AS ENUM ('PENDING', 'READY', 'APPROVED');

-- AlterEnum
ALTER TYPE "DesignSessionStatus" ADD VALUE 'VIEWS';

-- CreateTable
CREATE TABLE "ProductView" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "ProductViewType" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "versionId" TEXT,
    "status" "ProductViewStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductView_sessionId_type_position_key" ON "ProductView"("sessionId", "type", "position");

-- AddForeignKey
ALTER TABLE "ProductView" ADD CONSTRAINT "ProductView_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductView" ADD CONSTRAINT "ProductView_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DesignVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
