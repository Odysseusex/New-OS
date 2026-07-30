-- CreateEnum
CREATE TYPE "ProductionCancelReason" AS ENUM ('EQUIPMENT_FAILURE', 'NO_INGREDIENTS', 'MISTAKE', 'OTHER');

-- AlterEnum
ALTER TYPE "ProductionBatchStatus" ADD VALUE 'IN_PROGRESS';

-- AlterTable
ALTER TABLE "production_batches" ADD COLUMN     "cancelNote" TEXT,
ADD COLUMN     "cancelReason" "ProductionCancelReason",
ADD COLUMN     "startedAt" TIMESTAMP(3);

