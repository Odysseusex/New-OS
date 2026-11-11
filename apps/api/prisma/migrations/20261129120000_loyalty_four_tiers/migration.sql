-- Four levels: Бронза (earnPercent) → Серебро → Золото → Платина.
-- AlterEnum
ALTER TYPE "LoyaltyTier" ADD VALUE 'PLATINUM';

-- AlterTable
ALTER TABLE "loyalty_settings" ADD COLUMN     "platinumPercent" DECIMAL(5,2) NOT NULL DEFAULT 5,
ADD COLUMN     "platinumThreshold" DECIMAL(12,2) NOT NULL DEFAULT 150000,
ALTER COLUMN "goldPercent" SET DEFAULT 4,
ALTER COLUMN "silverPercent" SET DEFAULT 3;

-- Owner's decision (11.11.2026): every customer earns 2 % from the start, rising to 5 %.
-- Only rows still on the previous defaults are moved; levels that were already
-- switched on keep whatever was typed in.
UPDATE "loyalty_settings" SET "earnPercent" = 2 WHERE "earnPercent" = 1;
UPDATE "loyalty_settings" SET "silverPercent" = 3, "goldPercent" = 4
 WHERE "tiersEnabled" = false AND "silverPercent" = 2 AND "goldPercent" = 3;
