-- CreateEnum
CREATE TYPE "LoyaltyTier" AS ENUM ('BASE', 'SILVER', 'GOLD');

-- AlterTable
ALTER TABLE "loyalty_members" ADD COLUMN     "tier" "LoyaltyTier" NOT NULL DEFAULT 'BASE',
ADD COLUMN     "tierHeldUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "loyalty_settings" ADD COLUMN     "goldPercent" DECIMAL(5,2) NOT NULL DEFAULT 3,
ADD COLUMN     "goldThreshold" DECIMAL(12,2) NOT NULL DEFAULT 75000,
ADD COLUMN     "silverPercent" DECIMAL(5,2) NOT NULL DEFAULT 2,
ADD COLUMN     "silverThreshold" DECIMAL(12,2) NOT NULL DEFAULT 30000,
ADD COLUMN     "tierHoldDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "tierWindowDays" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "tiersEnabled" BOOLEAN NOT NULL DEFAULT false;

