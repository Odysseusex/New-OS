-- CreateEnum
CREATE TYPE "FiscalReceiptStatus" AS ENUM ('PENDING', 'SENDING', 'REGISTERED', 'FAILED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "ntin" TEXT;

-- CreateTable
CREATE TABLE "fiscal_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "status" "FiscalReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT NOT NULL,
    "providerTicketId" TEXT,
    "ticketNumber" TEXT,
    "offlineTicketNumber" TEXT,
    "isOffline" BOOLEAN NOT NULL DEFAULT false,
    "qrCode" TEXT,
    "kgdKkmId" TEXT,
    "shiftNumber" INTEGER,
    "registeredAt" TIMESTAMP(3),
    "providerResponse" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_receipts_saleId_key" ON "fiscal_receipts"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_receipts_externalId_key" ON "fiscal_receipts"("externalId");

-- CreateIndex
CREATE INDEX "fiscal_receipts_organizationId_status_idx" ON "fiscal_receipts"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

