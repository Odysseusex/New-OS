-- Welcome bonus: a fixed number of points for a member's first purchase,
-- usable from the next day for a limited number of days. Additive only.
ALTER TABLE "loyalty_settings"
  ADD COLUMN "welcomeBonusPoints" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "welcomeBonusDelayDays" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "welcomeBonusDays" INTEGER NOT NULL DEFAULT 10;

ALTER TABLE "loyalty_settings"
  ADD CONSTRAINT "loyalty_settings_welcome_check" CHECK (
    "welcomeBonusPoints" >= 0 AND
    "welcomeBonusDelayDays" >= 0 AND "welcomeBonusDelayDays" <= 30 AND
    "welcomeBonusDays" >= 1 AND "welcomeBonusDays" <= 365);

ALTER TABLE "loyalty_points_entries" ADD COLUMN "availableAt" TIMESTAMP(3);

-- Only a lot (positive entry) can wait to become usable, and it becomes usable before it expires.
ALTER TABLE "loyalty_points_entries"
  ADD CONSTRAINT "loyalty_points_entries_available_check" CHECK (
    "availableAt" IS NULL OR ("points" > 0 AND "availableAt" < "expiresAt"));
