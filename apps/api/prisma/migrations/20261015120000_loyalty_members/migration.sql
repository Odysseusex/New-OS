-- CreateEnum
CREATE TYPE "LoyaltyMemberStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'MERGED');

-- CreateEnum
CREATE TYPE "LoyaltyConsentPurpose" AS ENUM ('PERSONAL_DATA', 'MARKETING');

-- CreateEnum
CREATE TYPE "LoyaltyConsentChannel" AS ENUM ('WHATSAPP', 'TELEGRAM', 'SMS');

-- CreateEnum
CREATE TYPE "LoyaltyConsentSource" AS ENUM ('AT_TILL', 'PAPER_FORM', 'IMPORT', 'OTHER');

-- CreateTable
CREATE TABLE "loyalty_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "note" TEXT,
    "status" "LoyaltyMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "mergedIntoId" TEXT,
    "mergedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_consents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "purpose" "LoyaltyConsentPurpose" NOT NULL,
    "channel" "LoyaltyConsentChannel",
    "granted" BOOLEAN NOT NULL,
    "source" "LoyaltyConsentSource" NOT NULL,
    "recordedById" TEXT,
    "recordedByName" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "loyalty_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loyalty_members_organizationId_status_idx" ON "loyalty_members"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_members_organizationId_phone_key" ON "loyalty_members"("organizationId", "phone");

-- CreateIndex
CREATE INDEX "loyalty_consents_memberId_recordedAt_idx" ON "loyalty_consents"("memberId", "recordedAt");

-- CreateIndex
CREATE INDEX "loyalty_consents_organizationId_idx" ON "loyalty_consents"("organizationId");

-- AddForeignKey
ALTER TABLE "loyalty_members" ADD CONSTRAINT "loyalty_members_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "loyalty_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_consents" ADD CONSTRAINT "loyalty_consents_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A marketing consent names its channel; a personal-data consent has none.
ALTER TABLE "loyalty_consents"
  ADD CONSTRAINT "loyalty_consents_channel_check" CHECK (("purpose" = 'MARKETING') = ("channel" IS NOT NULL));

-- A merged member points somewhere else, and only a merged member does.
ALTER TABLE "loyalty_members"
  ADD CONSTRAINT "loyalty_members_merge_check" CHECK (("status" = 'MERGED') = ("mergedIntoId" IS NOT NULL)),
  ADD CONSTRAINT "loyalty_members_not_self_merge_check" CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> "id");

-- The consent record is the proof of who agreed to what and when: a change is a
-- new row (a withdrawal is a row too), never an edit of an old one.
CREATE FUNCTION loyalty_consent_reject_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Запись о согласии не изменяется: новое решение клиента вносится новой записью';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "loyalty_consents_immutable" BEFORE UPDATE ON "loyalty_consents"
  FOR EACH ROW EXECUTE FUNCTION loyalty_consent_reject_update();
