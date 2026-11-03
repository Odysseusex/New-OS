-- CreateEnum
CREATE TYPE "BusinessDirection" AS ENUM ('WHOLESALE', 'RETAIL', 'ORDERS');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "direction" "BusinessDirection";

