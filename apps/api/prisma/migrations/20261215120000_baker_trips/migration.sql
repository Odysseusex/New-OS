-- «Рейс»: bakers press «Рейс готов»; when all have, the day's new notes print on the door laptop. Additive.
CREATE TYPE "BakerTripStatus" AS ENUM ('WAITING', 'LAUNCHED', 'CANCELLED');

ALTER TABLE "baker_notes" ADD COLUMN "tripId" TEXT;

CREATE TABLE "baker_trips" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "BakerTripStatus" NOT NULL DEFAULT 'WAITING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "launchedAt" TIMESTAMP(3),
    "forcedByName" TEXT,
    "noteCount" INTEGER NOT NULL DEFAULT 0,
    "printJobId" TEXT,
    CONSTRAINT "baker_trips_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "baker_trip_confirmations" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "baker_trip_confirmations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "staff_push_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "baker_trips_organizationId_day_number_key" ON "baker_trips"("organizationId", "day", "number");
CREATE UNIQUE INDEX "baker_trip_confirmations_tripId_userId_key" ON "baker_trip_confirmations"("tripId", "userId");
CREATE UNIQUE INDEX "staff_push_subscriptions_endpoint_key" ON "staff_push_subscriptions"("endpoint");
CREATE INDEX "staff_push_subscriptions_userId_idx" ON "staff_push_subscriptions"("userId");

ALTER TABLE "baker_notes" ADD CONSTRAINT "baker_notes_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "baker_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "baker_trip_confirmations" ADD CONSTRAINT "baker_trip_confirmations_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "baker_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One trip waits at a time per organization.
CREATE UNIQUE INDEX "baker_trips_one_waiting" ON "baker_trips"("organizationId") WHERE "status" = 'WAITING';
