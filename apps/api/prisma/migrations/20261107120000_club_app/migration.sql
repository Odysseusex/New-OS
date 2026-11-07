-- CreateEnum
CREATE TYPE "ClubLoginStatus" AS ENUM ('PENDING', 'CONFIRMED', 'USED', 'REVOKED');

-- AlterEnum
ALTER TYPE "LoyaltyConsentSource" ADD VALUE 'CUSTOMER_APP';

-- AlterTable
ALTER TABLE "loyalty_members" ADD COLUMN     "cardSecret" TEXT;

-- CreateTable
CREATE TABLE "club_login_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "name" TEXT,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "status" "ClubLoginStatus" NOT NULL DEFAULT 'PENDING',
    "channel" TEXT,
    "memberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "club_login_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "club_login_requests_code_status_idx" ON "club_login_requests"("code", "status");

-- CreateIndex
CREATE INDEX "club_login_requests_phone_createdAt_idx" ON "club_login_requests"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "club_login_requests_memberId_idx" ON "club_login_requests"("memberId");

-- AddForeignKey
ALTER TABLE "club_login_requests" ADD CONSTRAINT "club_login_requests_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

