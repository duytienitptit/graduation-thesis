-- AlterEnum
ALTER TYPE "DesignSessionStatus" ADD VALUE 'LOCKED';

-- CreateTable
CREATE TABLE "LockedProduct" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LockedProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LockedProduct_sessionId_key" ON "LockedProduct"("sessionId");

-- AddForeignKey
ALTER TABLE "LockedProduct" ADD CONSTRAINT "LockedProduct_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "DesignSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
