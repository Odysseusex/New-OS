-- «Пересчёт» on the cashiers' phones: a role for a point's shared phone login and the day's count sheet. Additive.
ALTER TYPE "Role" ADD VALUE 'SHELF_COUNTER';

CREATE TYPE "ShelfCountStatus" AS ENUM ('OPEN', 'SENT');

CREATE TABLE "shelf_counts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "status" "ShelfCountStatus" NOT NULL DEFAULT 'OPEN',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shelf_counts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shelf_count_entries" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "kind" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shelf_count_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shelf_counts_organizationId_locationId_businessDate_key" ON "shelf_counts"("organizationId", "locationId", "businessDate");
CREATE UNIQUE INDEX "shelf_count_entries_countId_clientId_key" ON "shelf_count_entries"("countId", "clientId");
CREATE INDEX "shelf_count_entries_countId_idx" ON "shelf_count_entries"("countId");

ALTER TABLE "shelf_counts" ADD CONSTRAINT "shelf_counts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shelf_count_entries" ADD CONSTRAINT "shelf_count_entries_countId_fkey" FOREIGN KEY ("countId") REFERENCES "shelf_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
