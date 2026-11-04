-- Till shifts (кассовые смены): additive — one new table and an off-by-default setting.
-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "tillShiftsRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "till_shifts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedByName" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingCash" DECIMAL(12,2) NOT NULL,
    "bookCashAtOpen" DECIMAL(12,2) NOT NULL,
    "closedById" TEXT,
    "closedByName" TEXT,
    "closedAt" TIMESTAMP(3),
    "countedCash" DECIMAL(12,2),
    "expectedCash" DECIMAL(12,2),
    "difference" DECIMAL(12,2),
    "report" JSONB,
    "note" TEXT,

    CONSTRAINT "till_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "till_shifts_organizationId_openedAt_idx" ON "till_shifts"("organizationId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "till_shifts_locationId_number_key" ON "till_shifts"("locationId", "number");

-- AddForeignKey
ALTER TABLE "till_shifts" ADD CONSTRAINT "till_shifts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one open shift per point.
CREATE UNIQUE INDEX "till_shifts_one_open_per_location" ON "till_shifts"("locationId") WHERE "closedAt" IS NULL;

-- A closed shift is a record: nothing about it changes afterwards.
CREATE FUNCTION till_shift_reject_closed_update() RETURNS trigger AS $$
BEGIN
  IF OLD."closedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'a closed till shift cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "till_shifts_closed_immutable" BEFORE UPDATE ON "till_shifts"
  FOR EACH ROW EXECUTE FUNCTION till_shift_reject_closed_update();
