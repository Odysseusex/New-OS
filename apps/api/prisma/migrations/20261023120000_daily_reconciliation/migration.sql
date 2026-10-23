-- CreateTable
CREATE TABLE "daily_reconciliations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "openingCash" DECIMAL(14,2),
    "countedCash" DECIMAL(14,2),
    "countedCard" DECIMAL(14,2),
    "countedTransfer" DECIMAL(14,2),
    "note" TEXT,
    "moneyDifference" DECIMAL(14,2),
    "goodsDifference" DECIMAL(14,2),
    "result" DECIMAL(14,2),
    "savedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reconciliation_lines" (
    "id" TEXT NOT NULL,
    "reconciliationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "countedQuantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "daily_reconciliation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_reconciliations_organizationId_businessDate_idx" ON "daily_reconciliations"("organizationId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reconciliations_organizationId_locationId_businessDat_key" ON "daily_reconciliations"("organizationId", "locationId", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reconciliation_lines_reconciliationId_productId_key" ON "daily_reconciliation_lines"("reconciliationId", "productId");

-- AddForeignKey
ALTER TABLE "daily_reconciliations" ADD CONSTRAINT "daily_reconciliations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reconciliations" ADD CONSTRAINT "daily_reconciliations_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reconciliations" ADD CONSTRAINT "daily_reconciliations_savedById_fkey" FOREIGN KEY ("savedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reconciliation_lines" ADD CONSTRAINT "daily_reconciliation_lines_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "daily_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
