-- AlterTable
ALTER TABLE "fiscal_receipts" ADD COLUMN     "requestPayload" JSONB,
ALTER COLUMN "saleId" DROP NOT NULL;

