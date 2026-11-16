-- A product made at the moment it is sold when the shelf has none: half a cake cut from a whole one.
-- The sale makes the batch itself; such a batch carries the sale. Additive only.

-- AlterTable
ALTER TABLE "production_batches" ADD COLUMN     "saleId" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "makeOnSale" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "production_batches_saleId_idx" ON "production_batches"("saleId");

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
