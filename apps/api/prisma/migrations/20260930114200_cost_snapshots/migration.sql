-- CreateEnum
CREATE TYPE "ProductionCostComponent" AS ENUM ('INGREDIENT', 'PACKAGING', 'LABOR', 'UTILITY', 'OVERHEAD', 'TECHNOLOGICAL_LOSS');

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "costBasis" TEXT,
ADD COLUMN     "unitCost" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "sale_return_items" ADD COLUMN     "costBasis" TEXT,
ADD COLUMN     "unitCost" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "costBasis" TEXT,
ADD COLUMN     "unitCost" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "production_batch_costs" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "component" "ProductionCostComponent" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "basis" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_batch_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_batch_costs_batchId_component_key" ON "production_batch_costs"("batchId", "component");

-- AddForeignKey
ALTER TABLE "production_batch_costs" ADD CONSTRAINT "production_batch_costs_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "production_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

