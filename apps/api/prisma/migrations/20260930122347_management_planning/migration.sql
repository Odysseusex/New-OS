-- CreateEnum
CREATE TYPE "PlanMetric" AS ENUM ('NET_REVENUE', 'COGS', 'GROSS_PROFIT', 'OPERATING_EXPENSES', 'OPERATING_PROFIT');

-- CreateTable
CREATE TABLE "management_plan_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "metric" "PlanMetric" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "management_plan_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_model_scenarios" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "drivers" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_model_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "management_plan_lines_organizationId_year_month_metric_key" ON "management_plan_lines"("organizationId", "year", "month", "metric");

-- CreateIndex
CREATE INDEX "financial_model_scenarios_organizationId_idx" ON "financial_model_scenarios"("organizationId");

-- AddForeignKey
ALTER TABLE "management_plan_lines" ADD CONSTRAINT "management_plan_lines_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_model_scenarios" ADD CONSTRAINT "financial_model_scenarios_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

