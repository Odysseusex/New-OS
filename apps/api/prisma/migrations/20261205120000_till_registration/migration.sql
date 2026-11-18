-- The owner's switch: cashiers may register a customer by phone at the till.
-- Additive; existing programmes start with it ON (owner, 18.11.2026: «на чуточку открой»),
-- he switches it off on the programme card.
ALTER TABLE "loyalty_settings" ADD COLUMN "tillRegistration" BOOLEAN NOT NULL DEFAULT false;
UPDATE "loyalty_settings" SET "tillRegistration" = true;
