-- AlterEnum
ALTER TYPE "LoyaltyConsentSource" ADD VALUE 'TELEGRAM_BOT';

-- CreateTable
CREATE TABLE "loyalty_telegram_links" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_telegram_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_message_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_message_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_telegram_links_memberId_key" ON "loyalty_telegram_links"("memberId");

-- CreateIndex
CREATE INDEX "loyalty_telegram_links_chatId_idx" ON "loyalty_telegram_links"("chatId");

-- CreateIndex
CREATE INDEX "loyalty_telegram_links_organizationId_idx" ON "loyalty_telegram_links"("organizationId");

-- CreateIndex
CREATE INDEX "loyalty_message_logs_organizationId_sentAt_idx" ON "loyalty_message_logs"("organizationId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_message_logs_memberId_key_key" ON "loyalty_message_logs"("memberId", "key");

-- AddForeignKey
ALTER TABLE "loyalty_telegram_links" ADD CONSTRAINT "loyalty_telegram_links_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_message_logs" ADD CONSTRAINT "loyalty_message_logs_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

