-- CreateEnum
CREATE TYPE "FixedAssetStatus" AS ENUM ('ACTIVE', 'DISPOSED');

-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN     "fixedAssetId" TEXT;

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "locationId" TEXT,
    "acquisitionCost" DECIMAL(14,2) NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL,
    "sourceExpenseId" TEXT,
    "isOpening" BOOLEAN NOT NULL DEFAULT false,
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "depreciationMethod" "DepreciationMethod",
    "usefulLifeMonths" INTEGER,
    "salvageValue" DECIMAL(14,2),
    "depreciationStartYear" INTEGER,
    "depreciationStartMonth" INTEGER,
    "disposedAt" TIMESTAMP(3),
    "disposalProceeds" DECIMAL(14,2),
    "disposalBookValue" DECIMAL(14,2),
    "disposalResult" DECIMAL(14,2),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "DepreciationMethod" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depreciation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_sourceExpenseId_key" ON "fixed_assets"("sourceExpenseId");

-- CreateIndex
CREATE INDEX "fixed_assets_organizationId_status_idx" ON "fixed_assets"("organizationId", "status");

-- CreateIndex
CREATE INDEX "depreciation_entries_organizationId_year_month_idx" ON "depreciation_entries"("organizationId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_entries_assetId_year_month_key" ON "depreciation_entries"("assetId", "year", "month");

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_sourceExpenseId_fkey" FOREIGN KEY ("sourceExpenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

