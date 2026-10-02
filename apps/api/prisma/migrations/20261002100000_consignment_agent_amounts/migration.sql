-- Goods sold «под реализацию» are the owner's money, not our revenue.
-- Record, per sale and per return, how much of its total was such goods.
ALTER TABLE "sales" ADD COLUMN "consignmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "sale_returns" ADD COLUMN "consignmentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Existing documents: derived from their own lines (the lines already carry the
-- consignment snapshot), so history and new sales follow the same rule.
UPDATE "sales" s SET "consignmentAmount" = COALESCE((
  SELECT SUM(i."subtotal") FROM "sale_items" i
  WHERE i."saleId" = s."id" AND i."consignmentSupplierId" IS NOT NULL
), 0);

UPDATE "sale_returns" r SET "consignmentAmount" = COALESCE((
  SELECT SUM(i."subtotal") FROM "sale_return_items" i
  WHERE i."saleReturnId" = r."id" AND i."consignmentSupplierId" IS NOT NULL
), 0);
