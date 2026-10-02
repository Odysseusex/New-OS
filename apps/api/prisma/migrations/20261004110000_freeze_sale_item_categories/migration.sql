-- Freeze the category each past sale line had, BEFORE any mass reclassification.
--
-- Sales reports group a line by SaleItem.categoryIdSnapshot and fall back to the
-- product's CURRENT category only where the snapshot is NULL. Every sale made
-- before the category hierarchy shipped has a NULL snapshot, so moving a product
-- to another category would silently move its whole sales history with it.
--
-- This stamps each such line with the product's category as it is right now.
-- It touches only the NULL snapshot column: no amounts, prices, quantities,
-- stock, cash, costs or ledger rows. Lines that already carry a snapshot, and
-- lines whose product has no category, are left alone. Safe to run twice.
UPDATE "sale_items" AS si
SET "categoryIdSnapshot" = p."categoryId"
FROM "products" AS p
WHERE si."productId" = p."id"
  AND si."categoryIdSnapshot" IS NULL
  AND p."categoryId" IS NOT NULL;
