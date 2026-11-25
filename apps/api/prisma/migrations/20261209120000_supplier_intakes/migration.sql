-- CreateEnum
CREATE TYPE "SupplierIntakeStatus" AS ENUM ('UPLOADING', 'SENT', 'POSTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupplierIntakePayment" AS ENUM ('CASH', 'KASPI', 'BCC', 'CREDIT');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "supplierIntakeSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "supplier_intakes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "SupplierIntakeStatus" NOT NULL DEFAULT 'UPLOADING',
    "locationId" TEXT NOT NULL,
    "payment" "SupplierIntakePayment" NOT NULL,
    "supplierName" TEXT,
    "total" DECIMAL(14,2),
    "comment" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedByName" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "purchaseOrderId" TEXT,
    "documentLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_intake_photos" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "mime" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_intake_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_intakes_organizationId_status_idx" ON "supplier_intakes"("organizationId", "status");

-- CreateIndex
CREATE INDEX "supplier_intakes_organizationId_createdAt_idx" ON "supplier_intakes"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_intakes_organizationId_number_key" ON "supplier_intakes"("organizationId", "number");

-- CreateIndex
CREATE INDEX "supplier_intake_photos_intakeId_idx" ON "supplier_intake_photos"("intakeId");

-- AddForeignKey
ALTER TABLE "supplier_intakes" ADD CONSTRAINT "supplier_intakes_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_intake_photos" ADD CONSTRAINT "supplier_intake_photos_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "supplier_intakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

