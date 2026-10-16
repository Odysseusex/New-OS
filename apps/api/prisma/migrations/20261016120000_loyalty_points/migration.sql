-- CreateEnum
CREATE TYPE "LoyaltyPointsEntryType" AS ENUM ('EARN', 'REDEEM', 'EARN_REVERSAL', 'REDEEM_REFUND', 'EXPIRE', 'ADJUSTMENT', 'MERGE_IN', 'MERGE_OUT');

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "loyaltyDiscount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "loyaltyMemberId" TEXT;

-- CreateTable
CREATE TABLE "loyalty_settings" (
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "firstPurchaseEarnPercent" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "earnPercent" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "maxRedeemPercent" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "pointsLifetimeMonths" INTEGER NOT NULL DEFAULT 12,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "loyalty_settings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "loyalty_points_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" "LoyaltyPointsEntryType" NOT NULL,
    "points" DECIMAL(12,2) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "saleId" TEXT,
    "saleReturnId" TEXT,
    "ratePercent" DECIMAL(5,2),
    "reason" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_points_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loyalty_points_entries_memberId_createdAt_idx" ON "loyalty_points_entries"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_points_entries_organizationId_createdAt_idx" ON "loyalty_points_entries"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_points_entries_saleId_type_key" ON "loyalty_points_entries"("saleId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_points_entries_saleReturnId_type_key" ON "loyalty_points_entries"("saleReturnId", "type");

-- CreateIndex
CREATE INDEX "sales_loyaltyMemberId_idx" ON "sales"("loyaltyMemberId");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_loyaltyMemberId_fkey" FOREIGN KEY ("loyaltyMemberId") REFERENCES "loyalty_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_points_entries" ADD CONSTRAINT "loyalty_points_entries_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_points_entries" ADD CONSTRAINT "loyalty_points_entries_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_points_entries" ADD CONSTRAINT "loyalty_points_entries_saleReturnId_fkey" FOREIGN KEY ("saleReturnId") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A points movement is never zero; a lot (positive entry) carries an expiry, a
-- consumption (negative entry) does not.
ALTER TABLE "loyalty_points_entries"
  ADD CONSTRAINT "loyalty_points_entries_nonzero_check" CHECK ("points" <> 0),
  ADD CONSTRAINT "loyalty_points_entries_expiry_check" CHECK (("points" > 0) = ("expiresAt" IS NOT NULL));

-- Settings are sane by construction.
ALTER TABLE "loyalty_settings"
  ADD CONSTRAINT "loyalty_settings_percent_check" CHECK (
    "firstPurchaseEarnPercent" >= 0 AND "firstPurchaseEarnPercent" <= 100 AND
    "earnPercent" >= 0 AND "earnPercent" <= 100 AND
    "maxRedeemPercent" >= 0 AND "maxRedeemPercent" <= 100),
  ADD CONSTRAINT "loyalty_settings_lifetime_check" CHECK ("pointsLifetimeMonths" >= 1 AND "pointsLifetimeMonths" <= 120);

-- The points history is a ledger: corrections are new entries, never edits.
CREATE FUNCTION loyalty_points_reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Движение баллов не изменяется: исправление вносится новой записью';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "loyalty_points_entries_immutable" BEFORE UPDATE ON "loyalty_points_entries"
  FOR EACH ROW EXECUTE FUNCTION loyalty_points_reject_update();
