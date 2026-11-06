-- CreateEnum
CREATE TYPE "DesignerState" AS ENUM ('FREE', 'BUSY', 'PAUSED');

-- CreateTable
CREATE TABLE "DesignerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" "DesignerState" NOT NULL DEFAULT 'FREE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesignerProfile_userId_key" ON "DesignerProfile"("userId");

-- CreateIndex
CREATE INDEX "DesignerProfile_state_idx" ON "DesignerProfile"("state");

-- AddForeignKey
ALTER TABLE "DesignerProfile" ADD CONSTRAINT "DesignerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
