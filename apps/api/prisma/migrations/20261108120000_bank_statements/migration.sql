-- CreateEnum
CREATE TYPE "BankLineStatus" AS ENUM ('NEW', 'POSTED', 'IGNORED');

-- CreateEnum
CREATE TYPE "BankLineAction" AS ENUM ('SALES_SETTLEMENT', 'CATEGORY', 'TRANSFER', 'SUPPLIER_PAYMENT', 'IGNORE');

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "iban" TEXT,
    "holderBin" TEXT,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(14,2),
    "closingBalance" DECIMAL(14,2),
    "fileName" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "counterpartyName" TEXT,
    "counterpartyBin" TEXT,
    "counterpartyIban" TEXT,
    "knp" TEXT,
    "purpose" TEXT,
    "status" "BankLineStatus" NOT NULL DEFAULT 'NEW',
    "action" "BankLineAction",
    "categoryId" TEXT,
    "targetAccountId" TEXT,
    "supplierId" TEXT,
    "resultNote" TEXT,
    "postedAt" TIMESTAMP(3),
    "postedById" TEXT,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "direction" INTEGER NOT NULL,
    "counterpartyBin" TEXT,
    "purposeKey" TEXT,
    "action" "BankLineAction" NOT NULL,
    "categoryId" TEXT,
    "targetAccountId" TEXT,
    "supplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_statements_organizationId_accountId_idx" ON "bank_statements"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "bank_statement_lines_statementId_idx" ON "bank_statement_lines"("statementId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_organizationId_accountId_docNumber_key" ON "bank_statement_lines"("organizationId", "accountId", "docNumber");

-- CreateIndex
CREATE UNIQUE INDEX "bank_rules_organizationId_direction_counterpartyBin_purpose_key" ON "bank_rules"("organizationId", "direction", "counterpartyBin", "purposeKey");

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

