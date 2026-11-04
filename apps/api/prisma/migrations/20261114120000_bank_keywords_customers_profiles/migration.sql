-- Bank import: wholesale customer payments, keyword rules, saved column mappings per bank. Additive only.
-- AlterEnum
ALTER TYPE "BankLineAction" ADD VALUE 'CUSTOMER_PAYMENT';

-- AlterTable
ALTER TABLE "bank_rules" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "keyword" TEXT;

-- AlterTable
ALTER TABLE "bank_statement_lines" ADD COLUMN     "customerId" TEXT;

-- CreateTable
CREATE TABLE "bank_import_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_import_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_import_profiles_organizationId_bankName_key" ON "bank_import_profiles"("organizationId", "bankName");

