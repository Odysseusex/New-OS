-- CreateTable
CREATE TABLE "product_location_prices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_location_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_location_prices_organizationId_locationId_idx" ON "product_location_prices"("organizationId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "product_location_prices_productId_locationId_key" ON "product_location_prices"("productId", "locationId");

-- AddForeignKey
ALTER TABLE "product_location_prices" ADD CONSTRAINT "product_location_prices_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_location_prices" ADD CONSTRAINT "product_location_prices_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

