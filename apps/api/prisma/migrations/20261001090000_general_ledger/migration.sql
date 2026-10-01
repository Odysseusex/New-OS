-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COGS', 'OPERATING_EXPENSE', 'BELOW_OPERATING', 'TAX');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "AccountingEventStatus" AS ENUM ('POSTED', 'NOT_POSTED', 'UNAPPROVED', 'NO_GL_EFFECT', 'EXCEPTION', 'REVERSED');

-- CreateEnum
CREATE TYPE "JournalEntryKind" AS ENUM ('STANDARD', 'OPENING_BALANCE', 'MANUAL', 'REVERSAL');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('POSTED');

-- AlterEnum
ALTER TYPE "ProductionCostComponent" ADD VALUE 'ABNORMAL_LOSS';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "journalEntrySequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ledgerStartsAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "normalBalance" "NormalBalance" NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "systemAccountKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "accountingPeriodId" TEXT,
    "status" "AccountingEventStatus" NOT NULL,
    "statusReason" TEXT,
    "contentHash" TEXT,
    "metadata" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "accountingPeriodId" TEXT NOT NULL,
    "accountingEventId" TEXT,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "JournalEntryKind" NOT NULL DEFAULT 'STANDARD',
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'POSTED',
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" TEXT NOT NULL,
    "reversalOfEntryId" TEXT,
    "reversalReason" TEXT,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "journalEntryId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT,
    "cashSection" TEXT,
    "cashAccountId" TEXT,
    "locationId" TEXT,
    "productId" TEXT,
    "categoryId" TEXT,
    "customerId" TEXT,
    "supplierId" TEXT,
    "employeeId" TEXT,
    "financeCategoryId" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_accounts_organizationId_type_idx" ON "ledger_accounts"("organizationId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_organizationId_code_key" ON "ledger_accounts"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_organizationId_systemAccountKey_key" ON "ledger_accounts"("organizationId", "systemAccountKey");

-- CreateIndex
CREATE INDEX "accounting_events_organizationId_sourceType_sourceId_idx" ON "accounting_events"("organizationId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "accounting_events_organizationId_status_idx" ON "accounting_events"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_events_organizationId_eventKey_key" ON "accounting_events"("organizationId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_accountingEventId_key" ON "journal_entries"("accountingEventId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversalOfEntryId_key" ON "journal_entries"("reversalOfEntryId");

-- CreateIndex
CREATE INDEX "journal_entries_organizationId_entryDate_idx" ON "journal_entries"("organizationId", "entryDate");

-- CreateIndex
CREATE INDEX "journal_entries_organizationId_accountingPeriodId_idx" ON "journal_entries"("organizationId", "accountingPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organizationId_number_key" ON "journal_entries"("organizationId", "number");

-- CreateIndex
CREATE INDEX "journal_lines_organizationId_accountId_idx" ON "journal_lines"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "journal_lines_journalEntryId_idx" ON "journal_lines"("journalEntryId");

-- CreateIndex
CREATE INDEX "journal_lines_organizationId_locationId_idx" ON "journal_lines"("organizationId", "locationId");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_accountingPeriodId_fkey" FOREIGN KEY ("accountingPeriodId") REFERENCES "financial_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_events" ADD CONSTRAINT "accounting_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_accountingPeriodId_fkey" FOREIGN KEY ("accountingPeriodId") REFERENCES "financial_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_accountingEventId_fkey" FOREIGN KEY ("accountingEventId") REFERENCES "accounting_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversalOfEntryId_fkey" FOREIGN KEY ("reversalOfEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Database-level guards (not expressible in the Prisma schema) ───────────
-- These make the ledger's invariants hold even for a client that bypasses the
-- application: a line is either a debit or a credit, an entry balances, a
-- posted row is never rewritten.

ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_one_sided_positive_check"
  CHECK (
    "debit" >= 0 AND "credit" >= 0
    AND (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0))
    AND "amount" = "debit" + "credit"
  );

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_number_positive_check" CHECK ("number" > 0),
  ADD CONSTRAINT "journal_entries_not_self_reversal_check" CHECK ("reversalOfEntryId" IS NULL OR "reversalOfEntryId" <> "id");

-- Posted entries and their lines are immutable: corrections are new (reversal) entries.
CREATE FUNCTION ledger_reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Проведённая проводка не изменяется: исправление вносится сторно-записью (%)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_entries_immutable" BEFORE UPDATE ON "journal_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_update();
CREATE TRIGGER "journal_lines_immutable" BEFORE UPDATE ON "journal_lines"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_update();

-- An entry must balance. All lines of an entry arrive in ONE INSERT statement, and
-- this statement-level trigger checks them as a set: at least two lines, debits
-- equal credits, and no lines were already there (a posted entry is never added to).
-- It is deliberately NOT a deferred constraint trigger: the database client in use
-- does not report a failure at COMMIT, which would turn a rejected entry into a
-- silently rolled-back operation. A statement-level failure is reported at once.
CREATE FUNCTION ledger_check_lines_balanced() RETURNS trigger AS $$
DECLARE
  bad record;
BEGIN
  FOR bad IN
    SELECT n."journalEntryId" AS entry_id,
           SUM(n."debit") AS total_debit,
           SUM(n."credit") AS total_credit,
           COUNT(*) AS new_lines,
           (SELECT COUNT(*) FROM "journal_lines" l WHERE l."journalEntryId" = n."journalEntryId") AS all_lines
      FROM new_lines n
     GROUP BY n."journalEntryId"
  LOOP
    IF bad.new_lines < 2 THEN
      RAISE EXCEPTION 'Проводка должна содержать не менее двух строк (%)', bad.entry_id;
    END IF;
    IF bad.all_lines <> bad.new_lines THEN
      RAISE EXCEPTION 'Строки проводки вносятся одной операцией: проведённая проводка не дополняется (%)', bad.entry_id;
    END IF;
    IF bad.total_debit <> bad.total_credit THEN
      RAISE EXCEPTION 'Проводка не сбалансирована: дебет % ≠ кредит % (%)', bad.total_debit, bad.total_credit, bad.entry_id;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_lines_entry_balanced" AFTER INSERT ON "journal_lines"
  REFERENCING NEW TABLE AS new_lines
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_check_lines_balanced();
