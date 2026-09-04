-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN     "consignmentPaymentId" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "consignmentPrice" DECIMAL(12,2),
ADD COLUMN     "consignmentSupplierId" TEXT;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "consignmentSupplierId" TEXT,
ADD COLUMN     "consignmentUnitCost" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "sale_return_items" ADD COLUMN     "consignmentSupplierId" TEXT,
ADD COLUMN     "consignmentUnitCost" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "consignment_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consignment_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consignment_payments_organizationId_supplierId_idx" ON "consignment_payments"("organizationId", "supplierId");

-- CreateIndex
CREATE INDEX "sale_items_consignmentSupplierId_idx" ON "sale_items"("consignmentSupplierId");

-- CreateIndex
CREATE INDEX "sale_return_items_consignmentSupplierId_idx" ON "sale_return_items"("consignmentSupplierId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_consignmentSupplierId_fkey" FOREIGN KEY ("consignmentSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_consignmentSupplierId_fkey" FOREIGN KEY ("consignmentSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_consignmentSupplierId_fkey" FOREIGN KEY ("consignmentSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignment_payments" ADD CONSTRAINT "consignment_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consignment_payments" ADD CONSTRAINT "consignment_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_consignmentPaymentId_fkey" FOREIGN KEY ("consignmentPaymentId") REFERENCES "consignment_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

