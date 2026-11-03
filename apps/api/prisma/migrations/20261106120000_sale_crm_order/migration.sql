-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "crmOrderId" TEXT;

-- CreateIndex
CREATE INDEX "sales_crmOrderId_idx" ON "sales"("crmOrderId");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_crmOrderId_fkey" FOREIGN KEY ("crmOrderId") REFERENCES "crm_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

