-- CreateEnum
CREATE TYPE "LoyaltyMessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

-- AlterEnum
ALTER TYPE "LoyaltyConsentSource" ADD VALUE 'WHATSAPP';

-- AlterTable
ALTER TABLE "loyalty_message_logs" ADD COLUMN     "channel" "LoyaltyConsentChannel" NOT NULL DEFAULT 'TELEGRAM',
ADD COLUMN     "error" TEXT,
ADD COLUMN     "providerMessageId" TEXT,
ADD COLUMN     "status" "LoyaltyMessageStatus",
ADD COLUMN     "statusAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "loyalty_settings" ADD COLUMN     "whatsappBirthdayNotices" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "whatsappExpiryNotices" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "whatsappSaleNotices" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "loyalty_message_logs_providerMessageId_idx" ON "loyalty_message_logs"("providerMessageId");

