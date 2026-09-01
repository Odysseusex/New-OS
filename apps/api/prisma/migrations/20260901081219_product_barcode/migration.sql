-- AlterTable
ALTER TABLE "products" ADD COLUMN     "barcode" TEXT;

-- CreateIndex
CREATE INDEX "products_organizationId_barcode_idx" ON "products"("organizationId", "barcode");

