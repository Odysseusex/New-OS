-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "priceSourceLocationId" TEXT;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_priceSourceLocationId_fkey" FOREIGN KEY ("priceSourceLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

