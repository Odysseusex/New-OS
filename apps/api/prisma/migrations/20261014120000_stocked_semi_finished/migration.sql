-- Stocked semi-finished products. Purely additive: two nullable columns, no row is
-- changed. Every product and recipe keeps working exactly as before (null = not used).
ALTER TABLE "products" ADD COLUMN "averageUnitCost" DECIMAL(14,4);
ALTER TABLE "recipes" ADD COLUMN "uncountedNote" TEXT;
