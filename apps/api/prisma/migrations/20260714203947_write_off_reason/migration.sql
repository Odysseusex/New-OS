-- CreateEnum
CREATE TYPE "WriteOffReason" AS ENUM ('EXPIRED', 'DAMAGED', 'PRODUCTION_DEFECT', 'QUALITY_ISSUE', 'OTHER');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "writeOffReason" "WriteOffReason";

