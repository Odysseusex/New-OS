-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CashAccountType" AS ENUM ('BANK', 'CASH');

-- CreateEnum
CREATE TYPE "FinanceCategoryKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('OPENING_BALANCE', 'SALE_RECEIPT', 'CUSTOMER_PAYMENT', 'SUPPLIER_PAYMENT', 'EXPENSE_PAYMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'CASH_DEPOSIT', 'CASH_WITHDRAWAL', 'OTHER_INCOME', 'OTHER_EXPENSE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER');

-- AlterTable: new columns only — the old "category" column is kept until
-- the data backfill below has read it, then dropped at the very end.
ALTER TABLE "expenses"
  ADD COLUMN     "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN     "categoryId" TEXT,
  ADD COLUMN     "status" "ExpenseStatus" NOT NULL DEFAULT 'CONFIRMED';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH';

-- CreateTable
CREATE TABLE "cash_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CashAccountType" NOT NULL,
    "locationId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "currentBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_accounts_cash_needs_location" CHECK ("type" <> 'CASH' OR "locationId" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "finance_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "FinanceCategoryKind" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "categoryId" TEXT,
    "customerId" TEXT,
    "supplierId" TEXT,
    "saleId" TEXT,
    "expenseId" TEXT,
    "invoiceId" TEXT,
    "transferGroupId" TEXT,
    "correctsMovementId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_accounts_organizationId_idx" ON "cash_accounts"("organizationId");

-- CreateIndex
CREATE INDEX "cash_accounts_locationId_idx" ON "cash_accounts"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_organizationId_name_key" ON "cash_accounts"("organizationId", "name");

-- CreateIndex
CREATE INDEX "finance_categories_organizationId_idx" ON "finance_categories"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "finance_categories_organizationId_name_kind_key" ON "finance_categories"("organizationId", "name", "kind");

-- CreateIndex
CREATE INDEX "cash_movements_organizationId_accountId_idx" ON "cash_movements"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "cash_movements_occurredAt_idx" ON "cash_movements"("occurredAt");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_correctsMovementId_fkey" FOREIGN KEY ("correctsMovementId") REFERENCES "cash_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- DataMigration: seed the default category catalog for every existing
-- organization (6 expense categories matching the old hardcoded enum, plus
-- one general income category for manual "прочий доход" entries) so no
-- organization's category list starts out empty.
INSERT INTO "finance_categories" ("id", "organizationId", "name", "kind", "isActive", "createdAt", "updatedAt")
SELECT 'fincat-' || o."id" || '-rent', o."id", 'Аренда', 'EXPENSE'::"FinanceCategoryKind", true, now(), now() FROM "organizations" o
UNION ALL
SELECT 'fincat-' || o."id" || '-utilities', o."id", 'Коммунальные услуги', 'EXPENSE'::"FinanceCategoryKind", true, now(), now() FROM "organizations" o
UNION ALL
SELECT 'fincat-' || o."id" || '-salary', o."id", 'Зарплата', 'EXPENSE'::"FinanceCategoryKind", true, now(), now() FROM "organizations" o
UNION ALL
SELECT 'fincat-' || o."id" || '-marketing', o."id", 'Маркетинг', 'EXPENSE'::"FinanceCategoryKind", true, now(), now() FROM "organizations" o
UNION ALL
SELECT 'fincat-' || o."id" || '-logistics', o."id", 'Логистика', 'EXPENSE'::"FinanceCategoryKind", true, now(), now() FROM "organizations" o
UNION ALL
SELECT 'fincat-' || o."id" || '-other-expense', o."id", 'Прочее', 'EXPENSE'::"FinanceCategoryKind", true, now(), now() FROM "organizations" o
UNION ALL
SELECT 'fincat-' || o."id" || '-other-income', o."id", 'Прочий доход', 'INCOME'::"FinanceCategoryKind", true, now(), now() FROM "organizations" o;

-- DataMigration: point every existing expense at the matching seeded
-- category, and treat it as already fully paid — that was the only meaning
-- an Expense row had before this migration (there was no unpaid/draft
-- state), so this preserves today's P&L numbers exactly instead of
-- fabricating new accounts-payable out of history.
UPDATE "expenses" e
SET "categoryId" = 'fincat-' || e."organizationId" || '-' || (
      CASE e."category"::text
        WHEN 'RENT' THEN 'rent'
        WHEN 'UTILITIES' THEN 'utilities'
        WHEN 'SALARY' THEN 'salary'
        WHEN 'MARKETING' THEN 'marketing'
        WHEN 'LOGISTICS' THEN 'logistics'
        WHEN 'OTHER' THEN 'other-expense'
      END
    ),
    "amountPaid" = e."amount",
    "status" = 'CONFIRMED'::"ExpenseStatus";

-- DropColumn (safe now — every row's old value has been transcribed above)
ALTER TABLE "expenses" DROP COLUMN "category";

-- DropEnum
DROP TYPE "ExpenseCategory";
