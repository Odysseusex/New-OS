-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "demoParentId" TEXT,
ADD COLUMN     "demoReadyAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_demoParentId_key" ON "organizations"("demoParentId");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_demoParentId_fkey" FOREIGN KEY ("demoParentId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A sandbox's history is generated through the ordinary services, which stamp
-- "now"; this moves everything a DEMO organization got since `since` back by
-- `delta`, so each generated day lands on the date it stands for. It refuses any
-- organization that is not a demo one. Tables guarded by an UPDATE trigger
-- (journal, loyalty ledgers) are skipped — a sandbox writes nothing there.
CREATE OR REPLACE FUNCTION demo_shift_since(org TEXT, since TIMESTAMP(3), delta INTERVAL) RETURNS VOID AS $$
DECLARE
  r RECORD;
  sets TEXT;
  conds TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "organizations" WHERE "id" = org AND "demoParentId" IS NOT NULL) THEN
    RAISE EXCEPTION 'demo_shift_since: % is not a demo organization', org;
  END IF;

  FOR r IN
    SELECT c.table_name::text AS table_name, array_agg(c.column_name::text) AS cols
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type LIKE 'timestamp%'
      AND c.table_name <> 'organizations'
      AND EXISTS (
        SELECT 1 FROM information_schema.columns o
        WHERE o.table_schema = 'public' AND o.table_name = c.table_name AND o.column_name = 'organizationId'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class cl ON cl.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE n.nspname = 'public' AND cl.relname = c.table_name AND NOT t.tgisinternal
      )
    GROUP BY c.table_name
  LOOP
    SELECT string_agg(format('%1$I = CASE WHEN %1$I >= $1 THEN %1$I - $2 ELSE %1$I END', col), ', '),
           string_agg(format('%I >= $1', col), ' OR ')
      INTO sets, conds
      FROM unnest(r.cols) AS col;
    EXECUTE format('UPDATE %I SET %s WHERE "organizationId" = $3 AND (%s)', r.table_name, sets, conds)
      USING since, delta, org;
  END LOOP;

  UPDATE "production_batch_costs" pc SET "createdAt" = pc."createdAt" - delta
    FROM "production_batches" b
    WHERE b."id" = pc."batchId" AND b."organizationId" = org AND pc."createdAt" >= since;

  UPDATE "organizations" SET
    "createdAt" = CASE WHEN "createdAt" >= since THEN "createdAt" - delta ELSE "createdAt" END,
    "updatedAt" = CASE WHEN "updatedAt" >= since THEN "updatedAt" - delta ELSE "updatedAt" END,
    "financeInitializedAt" = CASE WHEN "financeInitializedAt" >= since THEN "financeInitializedAt" - delta ELSE "financeInitializedAt" END,
    "purchaseCutoverAt" = CASE WHEN "purchaseCutoverAt" >= since THEN "purchaseCutoverAt" - delta ELSE "purchaseCutoverAt" END
  WHERE "id" = org;
END;
$$ LANGUAGE plpgsql;
