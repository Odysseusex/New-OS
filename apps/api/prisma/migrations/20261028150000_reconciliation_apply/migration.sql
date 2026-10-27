-- AlterTable
ALTER TABLE "daily_reconciliations" ADD COLUMN     "appliedAt" TIMESTAMP(3),
ADD COLUMN     "appliedById" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "dailyReconciliationId" TEXT;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_dailyReconciliationId_fkey" FOREIGN KEY ("dailyReconciliationId") REFERENCES "daily_reconciliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reconciliations" ADD CONSTRAINT "daily_reconciliations_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

