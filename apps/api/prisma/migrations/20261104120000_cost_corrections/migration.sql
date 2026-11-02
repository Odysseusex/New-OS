-- Month-end cost corrections recorded at close (additive).
-- CreateTable
CREATE TABLE "cost_corrections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "cogsAmount" DECIMAL(14,2) NOT NULL,
    "lossAmount" DECIMAL(14,2) NOT NULL,
    "unstampedLines" INTEGER NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_corrections_organizationId_year_month_version_key" ON "cost_corrections"("organizationId", "year", "month", "version");

-- AddForeignKey
ALTER TABLE "cost_corrections" ADD CONSTRAINT "cost_corrections_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A recorded correction is what the books were told; it is never rewritten
-- (closing the month again writes a new version).
CREATE FUNCTION cost_correction_reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cost_corrections rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "cost_corrections_immutable" BEFORE UPDATE ON "cost_corrections"
  FOR EACH ROW EXECUTE FUNCTION cost_correction_reject_update();
