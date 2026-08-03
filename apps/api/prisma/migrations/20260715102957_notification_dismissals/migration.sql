-- CreateTable
CREATE TABLE "notification_dismissals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_dismissals_organizationId_userId_idx" ON "notification_dismissals"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_dismissals_userId_key_key" ON "notification_dismissals"("userId", "key");

-- AddForeignKey
ALTER TABLE "notification_dismissals" ADD CONSTRAINT "notification_dismissals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

