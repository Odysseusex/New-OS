-- A customer's advance counted toward one of their sales. Additive: a new
-- append-only table; nothing existing changes.
-- CreateTable
CREATE TABLE "customer_advance_applications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "customer_advance_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_advance_applications_organizationId_customerId_idx" ON "customer_advance_applications"("organizationId", "customerId");

-- CreateIndex
CREATE INDEX "customer_advance_applications_saleId_idx" ON "customer_advance_applications"("saleId");

-- AddForeignKey
ALTER TABLE "customer_advance_applications" ADD CONSTRAINT "customer_advance_applications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_advance_applications" ADD CONSTRAINT "customer_advance_applications_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Applications are posted facts: never rewritten.
CREATE FUNCTION customer_advance_application_reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "customer_advance_applications_immutable" BEFORE UPDATE ON "customer_advance_applications"
  FOR EACH ROW EXECUTE FUNCTION customer_advance_application_reject_update();
