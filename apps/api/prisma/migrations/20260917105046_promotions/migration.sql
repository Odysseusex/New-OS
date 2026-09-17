-- CreateEnum
CREATE TYPE "PromotionCouponStatus" AS ENUM ('ISSUED', 'REDEEMED', 'VOID');

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "promotionId" TEXT;

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxRedemptions" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_rules" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL,

    CONSTRAINT "promotion_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_coupons" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PromotionCouponStatus" NOT NULL DEFAULT 'ISSUED',
    "redeemedAt" TIMESTAMP(3),
    "redeemedSaleId" TEXT,
    "redeemedById" TEXT,
    "redeemedLocationId" TEXT,
    "discountTotal" DECIMAL(12,2),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_coupons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotions_organizationId_idx" ON "promotions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_rules_promotionId_categoryId_key" ON "promotion_rules"("promotionId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_coupons_redeemedSaleId_key" ON "promotion_coupons"("redeemedSaleId");

-- CreateIndex
CREATE INDEX "promotion_coupons_promotionId_status_idx" ON "promotion_coupons"("promotionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_coupons_organizationId_code_key" ON "promotion_coupons"("organizationId", "code");

-- CreateIndex
CREATE INDEX "sale_items_promotionId_idx" ON "sale_items"("promotionId");

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_rules" ADD CONSTRAINT "promotion_rules_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_rules" ADD CONSTRAINT "promotion_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_coupons" ADD CONSTRAINT "promotion_coupons_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_coupons" ADD CONSTRAINT "promotion_coupons_redeemedSaleId_fkey" FOREIGN KEY ("redeemedSaleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_coupons" ADD CONSTRAINT "promotion_coupons_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_coupons" ADD CONSTRAINT "promotion_coupons_redeemedLocationId_fkey" FOREIGN KEY ("redeemedLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

