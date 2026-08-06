-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "financeInitializedAt" TIMESTAMP(3),
ADD COLUMN     "financeInitializedById" TEXT,
ADD COLUMN     "openingInventoryValue" DECIMAL(14,2),
ADD COLUMN     "openingPayablesValue" DECIMAL(14,2),
ADD COLUMN     "openingReceivablesValue" DECIMAL(14,2);

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_financeInitializedById_fkey" FOREIGN KEY ("financeInitializedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DataMigration: seed a dedicated "Начальные остатки" expense category for
-- every existing organization, used to tag manually-entered opening
-- accounts-payable created during "Запуск финансового учёта" so those
-- entries stay visually distinguishable from ordinary day-to-day expenses.
INSERT INTO "finance_categories" ("id", "organizationId", "name", "kind", "isActive", "createdAt", "updatedAt")
SELECT 'fincat-' || o."id" || '-opening-balance', o."id", 'Начальные остатки', 'EXPENSE'::"FinanceCategoryKind", true, now(), now()
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "finance_categories" fc
  WHERE fc."organizationId" = o."id" AND fc."id" = 'fincat-' || o."id" || '-opening-balance'
);
