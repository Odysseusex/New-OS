-- A return against a sale on credit reduces what the buyer owes instead of
-- paying money back. Additive: existing returns were all paid back in money,
-- so their credited part is 0 (the default) and nothing historical changes.
ALTER TABLE "sales" ADD COLUMN "creditedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "sale_returns" ADD COLUMN "creditedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
