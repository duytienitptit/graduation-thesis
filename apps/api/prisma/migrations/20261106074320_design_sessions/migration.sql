-- CreateEnum
CREATE TYPE "DesignSessionStatus" AS ENUM ('ANSWERING');

-- CreateTable
CREATE TABLE "DesignSession" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "specSnapshot" JSONB NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "status" "DesignSessionStatus" NOT NULL DEFAULT 'ANSWERING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesignSession_customerId_idx" ON "DesignSession"("customerId");

-- AddForeignKey
ALTER TABLE "DesignSession" ADD CONSTRAINT "DesignSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
