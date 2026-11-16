-- Around a birthday on the card points may pay a larger share of a check.
-- Additive; 0 = no birthday rule. The owner asked for 50 % (16.11.2026), so a
-- programme that is already running starts with it.
ALTER TABLE "loyalty_settings" ADD COLUMN "birthdayRedeemPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
UPDATE "loyalty_settings" SET "birthdayRedeemPercent" = 50 WHERE "enabled" = true AND "maxRedeemPercent" < 50;
