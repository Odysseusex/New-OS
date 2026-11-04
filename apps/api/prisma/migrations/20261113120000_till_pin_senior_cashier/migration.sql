-- Till PIN, «Старший кассир», manual discount at the till, approved returns. Additive only.
-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SENIOR_CASHIER';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "tillLineRemovalApproval" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "manualDiscount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "sale_returns" ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "approvedByName" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "discountApprovedById" TEXT,
ADD COLUMN     "discountApprovedByName" TEXT,
ADD COLUMN     "manualDiscountAmount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pinDigest" TEXT,
ADD COLUMN     "pinSetAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "users_organizationId_pinDigest_key" ON "users"("organizationId", "pinDigest");

