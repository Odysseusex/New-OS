-- AlterTable
ALTER TABLE "products" ADD COLUMN     "consignmentLocationId" TEXT;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_consignmentLocationId_fkey" FOREIGN KEY ("consignmentLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

