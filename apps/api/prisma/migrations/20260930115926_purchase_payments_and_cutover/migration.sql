-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN     "purchaseOrderPaymentId" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "purchaseCutoverAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "purchase_order_items" ADD COLUMN     "receivedQuantity" DECIMAL(12,3),
ADD COLUMN     "receivedUnitCost" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "receivedTotal" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "purchase_order_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversalReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_order_payments_organizationId_purchaseOrderId_idx" ON "purchase_order_payments"("organizationId", "purchaseOrderId");

-- AddForeignKey
ALTER TABLE "purchase_order_payments" ADD CONSTRAINT "purchase_order_payments_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_payments" ADD CONSTRAINT "purchase_order_payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_payments" ADD CONSTRAINT "purchase_order_payments_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_payments" ADD CONSTRAINT "purchase_order_payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_purchaseOrderPaymentId_fkey" FOREIGN KEY ("purchaseOrderPaymentId") REFERENCES "purchase_order_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

