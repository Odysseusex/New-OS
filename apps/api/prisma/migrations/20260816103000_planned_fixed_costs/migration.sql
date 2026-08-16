-- CreateTable
CREATE TABLE "planned_fixed_costs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "locationId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planned_fixed_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planned_fixed_costs_organizationId_categoryId_idx" ON "planned_fixed_costs"("organizationId", "categoryId");

-- AddForeignKey
ALTER TABLE "planned_fixed_costs" ADD CONSTRAINT "planned_fixed_costs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_fixed_costs" ADD CONSTRAINT "planned_fixed_costs_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "finance_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_fixed_costs" ADD CONSTRAINT "planned_fixed_costs_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "planned_fixed_costs" ADD CONSTRAINT "planned_fixed_costs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

