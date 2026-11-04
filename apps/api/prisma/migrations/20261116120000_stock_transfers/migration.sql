-- CreateEnum
CREATE TYPE "MaterialRequisitionKind" AS ENUM ('REQUISITION', 'TRANSFER');

-- DropIndex
DROP INDEX "material_requisitions_organizationId_number_key";

-- AlterTable
ALTER TABLE "material_requisitions" ADD COLUMN     "kind" "MaterialRequisitionKind" NOT NULL DEFAULT 'REQUISITION';

-- CreateIndex
CREATE UNIQUE INDEX "material_requisitions_organizationId_kind_number_key" ON "material_requisitions"("organizationId", "kind", "number");

