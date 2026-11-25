-- CreateTable
CREATE TABLE "print_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "noteIds" TEXT[],
    "pack" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedById" TEXT,

    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "print_jobs_organizationId_claimedAt_createdAt_idx" ON "print_jobs"("organizationId", "claimedAt", "createdAt");
