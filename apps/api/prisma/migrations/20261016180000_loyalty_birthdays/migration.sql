-- AlterEnum
ALTER TYPE "LoyaltyPointsEntryType" ADD VALUE 'BIRTHDAY';

-- AlterTable
ALTER TABLE "loyalty_settings" ADD COLUMN     "birthdayBonusDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN     "birthdayBonusPoints" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "loyalty_family_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relation" TEXT,
    "birthMonth" INTEGER NOT NULL,
    "birthDay" INTEGER NOT NULL,
    "birthYear" INTEGER,
    "dateSetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "loyalty_family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_birthday_grants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "familyMemberId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "points" DECIMAL(12,2) NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_birthday_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loyalty_family_members_memberId_idx" ON "loyalty_family_members"("memberId");

-- CreateIndex
CREATE INDEX "loyalty_family_members_organizationId_birthMonth_birthDay_idx" ON "loyalty_family_members"("organizationId", "birthMonth", "birthDay");

-- CreateIndex
CREATE INDEX "loyalty_birthday_grants_organizationId_idx" ON "loyalty_birthday_grants"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_birthday_grants_familyMemberId_year_key" ON "loyalty_birthday_grants"("familyMemberId", "year");

-- AddForeignKey
ALTER TABLE "loyalty_family_members" ADD CONSTRAINT "loyalty_family_members_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_birthday_grants" ADD CONSTRAINT "loyalty_birthday_grants_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "loyalty_family_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "loyalty_family_members"
  ADD CONSTRAINT "loyalty_family_members_date_check" CHECK (
    "birthMonth" BETWEEN 1 AND 12 AND "birthDay" BETWEEN 1 AND 31 AND ("birthYear" IS NULL OR "birthYear" BETWEEN 1900 AND 2100));

ALTER TABLE "loyalty_settings"
  ADD CONSTRAINT "loyalty_settings_birthday_check" CHECK ("birthdayBonusPoints" >= 0 AND "birthdayBonusDays" BETWEEN 1 AND 365);
