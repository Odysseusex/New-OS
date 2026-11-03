-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "nonCashAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_nonCashAccountId_fkey" FOREIGN KEY ("nonCashAccountId") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

