-- CreateEnum
CREATE TYPE "StocktakeStatus" AS ENUM ('COUNTING', 'REVIEW', 'APPROVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "stocktakeId" TEXT;

-- CreateTable
CREATE TABLE "stocktakes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "StocktakeStatus" NOT NULL DEFAULT 'COUNTING',
    "note" TEXT,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stocktakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_lines" (
    "id" TEXT NOT NULL,
    "stocktakeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "systemQuantity" DECIMAL(12,3) NOT NULL,
    "countedQuantity" DECIMAL(12,3),
    "note" TEXT,
    "movementId" TEXT,

    CONSTRAINT "stocktake_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stocktakes_organizationId_locationId_idx" ON "stocktakes"("organizationId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_lines_movementId_key" ON "stocktake_lines"("movementId");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_lines_stocktakeId_productId_key" ON "stocktake_lines"("stocktakeId", "productId");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "stocktakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "stocktakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

