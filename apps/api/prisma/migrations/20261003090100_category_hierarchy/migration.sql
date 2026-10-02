-- Category hierarchy: Type → Category → Subcategory → Product.
-- Purely additive. No category or product is deleted, moved or renamed, every id
-- and every products."categoryId" stays exactly as it was, and no transaction,
-- stock movement or accounting row is touched.

ALTER TABLE "categories" ADD COLUMN "type" "ProductType";
ALTER TABLE "categories" ADD COLUMN "parentId" TEXT;

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Names: unique among siblings. The old organization-wide constraint is replaced
-- by (a) the sibling one below and (b) a partial index that keeps TOP-LEVEL names
-- unique across the organization, as they always were. All existing categories
-- are top-level and already satisfy both.
DROP INDEX "categories_organizationId_name_key";
CREATE UNIQUE INDEX "categories_organizationId_parentId_name_key" ON "categories"("organizationId", "parentId", "name");
CREATE UNIQUE INDEX "categories_organizationId_name_top_level_key" ON "categories"("organizationId", "name") WHERE "parentId" IS NULL;
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- Deterministic typing of EXISTING categories, from the products they already
-- hold — never from names. A category whose products are all of one type takes
-- that type; an empty one, or one holding products of several types, stays
-- untyped ("legacy") and usable by any type until a person decides.
-- [deterministic-typing]
UPDATE "categories" c
SET "type" = t."type"
FROM (
  SELECT p."categoryId" AS id, (array_agg(p."type"))[1] AS "type"
  FROM "products" p
  WHERE p."categoryId" IS NOT NULL
  GROUP BY p."categoryId"
  HAVING COUNT(DISTINCT p."type") = 1
) t
WHERE c."id" = t.id AND c."type" IS NULL;

-- The category a product had at the moment it was sold. Nullable: every
-- existing sale line stays NULL (legacy) and is never back-filled.
ALTER TABLE "sale_items" ADD COLUMN "categoryIdSnapshot" TEXT;
