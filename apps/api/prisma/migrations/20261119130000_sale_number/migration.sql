-- Our own check number per organization (searchable at the till and in Продажи).
-- Additive: existing checks are numbered in the order they were rung up, and the
-- organization's counter continues after the last one. Nothing else changes.
ALTER TABLE "organizations" ADD COLUMN "saleSequence" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "sales" ADD COLUMN "number" INTEGER;

UPDATE "sales" s
SET "number" = n.rn
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "soldAt", "id") AS rn
  FROM "sales"
) n
WHERE s."id" = n."id";

UPDATE "organizations" o
SET "saleSequence" = COALESCE((SELECT MAX("number") FROM "sales" s WHERE s."organizationId" = o."id"), 0);

CREATE UNIQUE INDEX "sales_organizationId_number_key" ON "sales"("organizationId", "number");
