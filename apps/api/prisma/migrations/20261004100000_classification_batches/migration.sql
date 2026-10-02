-- Product classification batches (Preview → Apply → Audit → Rollback).
-- Purely additive: two new tables and an enum. No existing table or row is
-- touched; the batches only ever record changes to products.categoryId.

CREATE TYPE "ClassificationBatchStatus" AS ENUM ('APPLIED', 'PARTIALLY_REVERTED', 'REVERTED');

CREATE TABLE "classification_batches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "note" TEXT,
    "status" "ClassificationBatchStatus" NOT NULL DEFAULT 'APPLIED',
    "createdCategoryIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revertedAt" TIMESTAMP(3),
    "revertedById" TEXT,

    CONSTRAINT "classification_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "classification_batch_lines" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "beforeCategoryId" TEXT,
    "afterCategoryId" TEXT NOT NULL,
    "beforeLabel" TEXT,
    "afterLabel" TEXT NOT NULL,
    "revertedAt" TIMESTAMP(3),

    CONSTRAINT "classification_batch_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "classification_batches_organizationId_createdAt_idx" ON "classification_batches"("organizationId", "createdAt");
CREATE INDEX "classification_batch_lines_batchId_idx" ON "classification_batch_lines"("batchId");

ALTER TABLE "classification_batch_lines" ADD CONSTRAINT "classification_batch_lines_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "classification_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
