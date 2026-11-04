-- CreateEnum
CREATE TYPE "MaterialRequisitionStatus" AS ENUM ('DRAFT', 'POSTED');

-- AlterTable
ALTER TABLE "production_batches" ADD COLUMN     "recipeVersionId" TEXT;

-- AlterTable
ALTER TABLE "recipe_items" ADD COLUMN     "lossPercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "materialRequisitionId" TEXT;

-- CreateTable
CREATE TABLE "recipe_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL,
    "yieldQuantity" DECIMAL(12,3) NOT NULL,
    "lossPercent" DECIMAL(5,2),
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_requisitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "MaterialRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "planDate" TIMESTAMP(3) NOT NULL,
    "batchIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "postedById" TEXT,
    "postedByName" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_requisition_lines" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "requiredQuantity" DECIMAL(12,3),
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "material_requisition_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipe_versions_organizationId_idx" ON "recipe_versions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_versions_recipeId_number_key" ON "recipe_versions"("recipeId", "number");

-- CreateIndex
CREATE INDEX "material_requisitions_organizationId_planDate_idx" ON "material_requisitions"("organizationId", "planDate");

-- CreateIndex
CREATE UNIQUE INDEX "material_requisitions_organizationId_number_key" ON "material_requisitions"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "material_requisition_lines_requisitionId_productId_key" ON "material_requisition_lines"("requisitionId", "productId");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_materialRequisitionId_fkey" FOREIGN KEY ("materialRequisitionId") REFERENCES "material_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requisitions" ADD CONSTRAINT "material_requisitions_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requisitions" ADD CONSTRAINT "material_requisitions_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requisition_lines" ADD CONSTRAINT "material_requisition_lines_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "material_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_requisition_lines" ADD CONSTRAINT "material_requisition_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_recipeVersionId_fkey" FOREIGN KEY ("recipeVersionId") REFERENCES "recipe_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Recipe versions are append-only.
CREATE FUNCTION recipe_version_reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "recipe_versions_immutable" BEFORE UPDATE ON "recipe_versions"
  FOR EACH ROW EXECUTE FUNCTION recipe_version_reject_update();

-- A posted requisition has moved stock; it is never changed afterwards.
CREATE FUNCTION material_requisition_reject_posted_update() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'a posted material requisition cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "material_requisitions_posted_immutable" BEFORE UPDATE ON "material_requisitions"
  FOR EACH ROW EXECUTE FUNCTION material_requisition_reject_posted_update();

-- Version 1 of every existing recipe: its composition today, which has been in
-- force since its last save (updatedAt).
INSERT INTO "recipe_versions" ("id", "organizationId", "recipeId", "number", "validFrom", "createdById", "createdByName", "yieldQuantity", "lossPercent", "items")
SELECT
  'rv_' || replace(gen_random_uuid()::text, '-', ''),
  r."organizationId",
  r."id",
  1,
  r."updatedAt",
  NULL,
  'Версия на момент перехода',
  r."yieldQuantity",
  r."lossPercent",
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'ingredientProductId', i."ingredientProductId",
      'name', p."name",
      'unit', p."unit",
      'quantity', i."quantity",
      'lossPercent', i."lossPercent"
    ) ORDER BY p."name")
    FROM "recipe_items" i JOIN "products" p ON p."id" = i."ingredientProductId"
    WHERE i."recipeId" = r."id"
  ), '[]'::jsonb)
FROM "recipes" r;
