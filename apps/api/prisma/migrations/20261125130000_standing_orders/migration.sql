-- CreateTable
CREATE TABLE "standing_order_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "locationId" TEXT,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standing_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "standing_order_lines_organizationId_idx" ON "standing_order_lines"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "standing_order_lines_customerId_productId_key" ON "standing_order_lines"("customerId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "standing_order_lines_locationId_productId_key" ON "standing_order_lines"("locationId", "productId");

-- AddForeignKey
ALTER TABLE "standing_order_lines" ADD CONSTRAINT "standing_order_lines_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_order_lines" ADD CONSTRAINT "standing_order_lines_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standing_order_lines" ADD CONSTRAINT "standing_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A standing order belongs to exactly one target: a point or a wholesale customer.
ALTER TABLE "standing_order_lines" ADD CONSTRAINT "standing_order_lines_one_target"
  CHECK (("customerId" IS NULL) <> ("locationId" IS NULL));
