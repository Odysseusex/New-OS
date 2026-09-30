-- CreateEnum
CREATE TYPE "NegativeStockPolicy" AS ENUM ('BLOCK');

-- CreateEnum
CREATE TYPE "WriteOffPresentation" AS ENUM ('SEPARATE_LINE', 'IN_COGS');

-- CreateEnum
CREATE TYPE "ReturnScrapPresentation" AS ENUM ('KEEP_IN_COGS', 'INVENTORY_LOSS');

-- CreateEnum
CREATE TYPE "BalanceControlMode" AS ENUM ('WARN', 'BLOCK');

-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'NOT_DEPRECIATED');

-- CreateTable
CREATE TABLE "accounting_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "negativeStockPolicy" "NegativeStockPolicy",
    "writeOffPresentation" "WriteOffPresentation",
    "returnScrapPresentation" "ReturnScrapPresentation",
    "balanceControlMode" "BalanceControlMode",
    "capitalizationThreshold" DECIMAL(14,2),
    "depreciationMethod" "DepreciationMethod",
    "depreciationUsefulLifeMonths" INTEGER,
    "approvals" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_policies_organizationId_key" ON "accounting_policies"("organizationId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_entityType_entityId_idx" ON "audit_logs"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- AddForeignKey
ALTER TABLE "accounting_policies" ADD CONSTRAINT "accounting_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_policies" ADD CONSTRAINT "accounting_policies_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

