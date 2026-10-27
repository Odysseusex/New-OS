-- CreateEnum
CREATE TYPE "CrmContactChannel" AS ENUM ('WHATSAPP', 'TELEGRAM', 'CALL', 'SMS', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "CrmContactOutcome" AS ENUM ('SENT', 'TALKED', 'NO_ANSWER', 'DECLINED', 'ORDERED');

-- CreateEnum
CREATE TYPE "CrmContactReason" AS ENUM ('DUE', 'LAPSED', 'BIRTHDAY', 'WHOLESALE', 'ORDER', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmOrderStage" AS ENUM ('NEW', 'AGREED', 'PREPAID', 'IN_PRODUCTION', 'READY', 'DONE', 'CANCELLED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'CLIENT_MANAGER';

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT,
    "customerId" TEXT,
    "orderId" TEXT,
    "channel" "CrmContactChannel" NOT NULL,
    "outcome" "CrmContactOutcome" NOT NULL,
    "reason" "CrmContactReason" NOT NULL,
    "note" TEXT,
    "byId" TEXT,
    "byName" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "memberId" TEXT,
    "customerName" TEXT NOT NULL,
    "phone" TEXT,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "weightKg" DECIMAL(8,3),
    "price" DECIMAL(12,2),
    "prepaid" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "stage" "CrmOrderStage" NOT NULL DEFAULT 'NEW',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_order_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStage" "CrmOrderStage",
    "toStage" "CrmOrderStage" NOT NULL,
    "byName" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_contacts_organizationId_at_idx" ON "crm_contacts"("organizationId", "at");

-- CreateIndex
CREATE INDEX "crm_contacts_memberId_at_idx" ON "crm_contacts"("memberId", "at");

-- CreateIndex
CREATE INDEX "crm_contacts_customerId_at_idx" ON "crm_contacts"("customerId", "at");

-- CreateIndex
CREATE INDEX "crm_orders_organizationId_stage_dueAt_idx" ON "crm_orders"("organizationId", "stage", "dueAt");

-- CreateIndex
CREATE INDEX "crm_orders_memberId_idx" ON "crm_orders"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_orders_organizationId_number_key" ON "crm_orders"("organizationId", "number");

-- CreateIndex
CREATE INDEX "crm_order_events_orderId_at_idx" ON "crm_order_events"("orderId", "at");

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_orders" ADD CONSTRAINT "crm_orders_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_order_events" ADD CONSTRAINT "crm_order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "crm_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A contact is a statement of what happened; it is never rewritten.
CREATE FUNCTION crm_contact_reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'crm_contacts rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "crm_contacts_immutable" BEFORE UPDATE ON "crm_contacts"
  FOR EACH ROW EXECUTE FUNCTION crm_contact_reject_update();
