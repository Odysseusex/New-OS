-- CreateTable
CREATE TABLE "club_push_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_push_notices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_push_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "club_push_subscriptions_endpoint_key" ON "club_push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "club_push_subscriptions_memberId_idx" ON "club_push_subscriptions"("memberId");

-- CreateIndex
CREATE INDEX "club_push_notices_organizationId_sentAt_idx" ON "club_push_notices"("organizationId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "club_push_notices_memberId_key_key" ON "club_push_notices"("memberId", "key");

-- AddForeignKey
ALTER TABLE "club_push_subscriptions" ADD CONSTRAINT "club_push_subscriptions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_push_notices" ADD CONSTRAINT "club_push_notices_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "loyalty_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

