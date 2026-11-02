-- Corrections of a received purchase order, made inside the document (additive).
-- CreateTable
CREATE TABLE "purchase_order_revisions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "totalBefore" DECIMAL(12,2) NOT NULL,
    "totalAfter" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_revision_lines" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantityBefore" DECIMAL(12,3) NOT NULL,
    "quantityAfter" DECIMAL(12,3) NOT NULL,
    "unitCostBefore" DECIMAL(12,2) NOT NULL,
    "unitCostAfter" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "purchase_order_revision_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_order_revisions_organizationId_idx" ON "purchase_order_revisions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_revisions_purchaseOrderId_number_key" ON "purchase_order_revisions"("purchaseOrderId", "number");

-- CreateIndex
CREATE INDEX "purchase_order_revision_lines_revisionId_idx" ON "purchase_order_revision_lines"("revisionId");

-- AddForeignKey
ALTER TABLE "purchase_order_revisions" ADD CONSTRAINT "purchase_order_revisions_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_revisions" ADD CONSTRAINT "purchase_order_revisions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_revision_lines" ADD CONSTRAINT "purchase_order_revision_lines_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "purchase_order_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_revision_lines" ADD CONSTRAINT "purchase_order_revision_lines_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "purchase_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A correction is a statement of what the document said and what it says now;
-- it is never rewritten.
CREATE FUNCTION purchase_order_revision_reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "purchase_order_revisions_immutable" BEFORE UPDATE ON "purchase_order_revisions"
  FOR EACH ROW EXECUTE FUNCTION purchase_order_revision_reject_update();

CREATE TRIGGER "purchase_order_revision_lines_immutable" BEFORE UPDATE ON "purchase_order_revision_lines"
  FOR EACH ROW EXECUTE FUNCTION purchase_order_revision_reject_update();
