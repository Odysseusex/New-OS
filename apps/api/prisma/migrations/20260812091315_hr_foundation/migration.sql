-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CompensationType" AS ENUM ('MONTHLY', 'HOURLY', 'PIECE_RATE');

-- CreateEnum
CREATE TYPE "CostBehavior" AS ENUM ('FIXED', 'VARIABLE', 'UNCLASSIFIED');

-- CreateTable: employees (no FKs yet — added after backfill, at the end,
-- alongside every other new-table FK, to keep this migration's shape
-- predictable: structure first, data next, constraints last).
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT,
    "fullName" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "phone" TEXT,
    "hiredAt" TIMESTAMP(3),
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable: employee_compensations (starts empty — no historical
-- compensation data exists anywhere to migrate; only populated going
-- forward through the new UI).
CREATE TABLE "employee_compensations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentType" "CompensationType" NOT NULL DEFAULT 'MONTHLY',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_compensations_pkey" PRIMARY KEY ("id")
);

-- Backfill: every existing User becomes an Employee, 1:1-linked back to
-- that User. Position has no real source data today (no job-title concept
-- existed before this migration) — falls back to User.title where set,
-- else a plain placeholder the owner can rename via the new UI.
-- Deterministic id ('emp-' || user id) needs no UUID extension and is
-- trivially unique since user ids already are.
INSERT INTO "employees" ("id", "organizationId", "locationId", "fullName", "position", "status", "userId", "createdAt", "updatedAt")
SELECT
  'emp-' || u.id,
  u."organizationId",
  u."locationId",
  u."fullName",
  COALESCE(u.title, 'Сотрудник'),
  CASE WHEN u."isActive" THEN 'ACTIVE'::"EmployeeStatus" ELSE 'INACTIVE'::"EmployeeStatus" END,
  u.id,
  u."createdAt",
  u."updatedAt"
FROM "users" u;

-- AlterTable: finance_categories — add costBehavior, default UNCLASSIFIED
-- for every existing category (custom or seeded), then explicitly promote
-- only the handful of seeded categories whose behavior is genuinely
-- unambiguous. "Коммунальные услуги" and "Прочее" are deliberately left
-- UNCLASSIFIED — see the schema comment on CostBehavior for why.
ALTER TABLE "finance_categories" ADD COLUMN     "costBehavior" "CostBehavior" NOT NULL DEFAULT 'UNCLASSIFIED';

UPDATE "finance_categories" SET "costBehavior" = 'FIXED'
WHERE "kind" = 'EXPENSE' AND "name" IN ('Аренда', 'Зарплата', 'Маркетинг');

UPDATE "finance_categories" SET "costBehavior" = 'VARIABLE'
WHERE "kind" = 'EXPENSE' AND "name" IN ('Логистика');

-- AlterTable: shifts / time_entries — add the new columns nullable first,
-- backfill from the just-created employees, THEN tighten to NOT NULL and
-- drop the old userId column. Never drop-before-backfill.
ALTER TABLE "shifts" ADD COLUMN "employeeId" TEXT;
ALTER TABLE "time_entries" ADD COLUMN "employeeId" TEXT;
ALTER TABLE "time_entries" ADD COLUMN "recordedById" TEXT;

UPDATE "shifts" s SET "employeeId" = 'emp-' || s."userId";
-- Historically every TimeEntry was self-recorded (clock-in required being
-- logged in as yourself) — recordedById = the same person as employeeId's
-- linked user for every pre-existing row.
UPDATE "time_entries" t SET "employeeId" = 'emp-' || t."userId", "recordedById" = t."userId";

ALTER TABLE "shifts" ALTER COLUMN "employeeId" SET NOT NULL;
ALTER TABLE "time_entries" ALTER COLUMN "employeeId" SET NOT NULL;
ALTER TABLE "time_entries" ALTER COLUMN "recordedById" SET NOT NULL;

-- DropForeignKey (old userId-based constraints)
ALTER TABLE "shifts" DROP CONSTRAINT "shifts_userId_fkey";
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_userId_fkey";

-- DropIndex
DROP INDEX "time_entries_userId_idx";

-- AlterTable: finally drop the old columns now that employeeId is populated.
ALTER TABLE "shifts" DROP COLUMN "userId";
ALTER TABLE "time_entries" DROP COLUMN "userId";

-- CreateIndex
CREATE UNIQUE INDEX "employees_userId_key" ON "employees"("userId");
CREATE INDEX "employees_organizationId_locationId_idx" ON "employees"("organizationId", "locationId");
CREATE INDEX "employee_compensations_organizationId_employeeId_idx" ON "employee_compensations"("organizationId", "employeeId");
CREATE INDEX "time_entries_employeeId_idx" ON "time_entries"("employeeId");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_compensations" ADD CONSTRAINT "employee_compensations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_compensations" ADD CONSTRAINT "employee_compensations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "shifts" ADD CONSTRAINT "shifts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
