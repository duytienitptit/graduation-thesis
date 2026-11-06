-- AlterTable
ALTER TABLE "DesignerProfile" ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "telegramUsername" TEXT;

-- CreateTable
CREATE TABLE "TelegramLinkCode" (
    "code" TEXT NOT NULL,
    "designerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "TelegramLinkCode_designerId_idx" ON "TelegramLinkCode"("designerId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignerProfile_telegramChatId_key" ON "DesignerProfile"("telegramChatId");

-- AddForeignKey
ALTER TABLE "TelegramLinkCode" ADD CONSTRAINT "TelegramLinkCode_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "DesignerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

