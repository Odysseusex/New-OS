-- Справочник направлений (ТЗ §2): a table, a point's default direction, an expense's direction by id.
-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "directionId" TEXT;

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "defaultDirectionId" TEXT;

-- CreateTable
CREATE TABLE "directions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "responsible" TEXT,
    "systemKey" "BusinessDirection",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "directions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "directions_organizationId_idx" ON "directions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "directions_organizationId_systemKey_key" ON "directions"("organizationId", "systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "directions_organizationId_name_key" ON "directions"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_defaultDirectionId_fkey" FOREIGN KEY ("defaultDirectionId") REFERENCES "directions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directions" ADD CONSTRAINT "directions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "directions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The three directions every organization already had (they keep their automatic rules).
INSERT INTO "directions" ("id", "organizationId", "name", "systemKey", "isActive", "createdAt", "updatedAt")
SELECT 'dir_' || md5(o."id" || ':' || k.key), o."id", k.name, k.key::"BusinessDirection", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES ('WHOLESALE', 'Опт'), ('RETAIL', 'Розница'), ('ORDERS', 'Заказы')) AS k(key, name);

-- An expense already booked to one of them keeps it (new column only; the old one is left as it was).
UPDATE "expenses" e SET "directionId" = d."id"
FROM "directions" d
WHERE e."direction" IS NOT NULL AND d."organizationId" = e."organizationId" AND d."systemKey" = e."direction";
