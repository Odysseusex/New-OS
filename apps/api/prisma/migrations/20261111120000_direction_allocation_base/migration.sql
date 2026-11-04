-- How common costs are shared between business directions (management view only).
ALTER TABLE "organizations" ADD COLUMN "directionAllocationBase" TEXT;
ALTER TABLE "organizations" ADD COLUMN "directionAllocationShares" JSONB;
