-- Additive: an optional code on finance articles, and our own number on purchase
-- orders. Existing orders are numbered per organization in the order they were
-- placed (1, 2, 3…); nothing else about them changes.
ALTER TABLE "finance_categories" ADD COLUMN "code" TEXT;

ALTER TABLE "purchase_orders" ADD COLUMN "number" INTEGER;

UPDATE "purchase_orders" p
SET "number" = n.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "orderedAt", "id") AS rn
  FROM "purchase_orders"
) n
WHERE p."id" = n."id";

CREATE UNIQUE INDEX "purchase_orders_organizationId_number_key" ON "purchase_orders"("organizationId", "number");
