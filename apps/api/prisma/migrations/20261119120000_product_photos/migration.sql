-- Product pictures for the till (additive table).
-- CreateTable
CREATE TABLE "product_photos" (
    "productId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_photos_pkey" PRIMARY KEY ("productId")
);

-- CreateIndex
CREATE INDEX "product_photos_organizationId_idx" ON "product_photos"("organizationId");

-- AddForeignKey
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

