-- CreateEnum
CREATE TYPE "RecipeParameterKind" AS ENUM ('TEMPERATURE_C', 'DURATION_MINUTES', 'PERCENT', 'WEIGHT_G', 'COUNT');

-- CreateTable
CREATE TABLE "recipe_stage_types" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_stage_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_stages" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "stageTypeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "recipe_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_stage_parameters" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "kind" "RecipeParameterKind" NOT NULL,
    "label" TEXT,
    "value" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "recipe_stage_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipe_stage_types_organizationId_idx" ON "recipe_stage_types"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_stage_types_organizationId_name_key" ON "recipe_stage_types"("organizationId", "name");

-- CreateIndex
CREATE INDEX "recipe_stages_recipeId_idx" ON "recipe_stages"("recipeId");

-- CreateIndex
CREATE INDEX "recipe_stage_parameters_stageId_idx" ON "recipe_stage_parameters"("stageId");

-- AddForeignKey
ALTER TABLE "recipe_stages" ADD CONSTRAINT "recipe_stages_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_stages" ADD CONSTRAINT "recipe_stages_stageTypeId_fkey" FOREIGN KEY ("stageTypeId") REFERENCES "recipe_stage_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_stage_parameters" ADD CONSTRAINT "recipe_stage_parameters_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "recipe_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: seed the default, extensible stage-type catalog for every existing organization.
INSERT INTO "recipe_stage_types" ("id", "organizationId", "name", "isActive", "updatedAt")
SELECT md5(o."id" || ':stagetype:' || s.name), o."id", s.name, true, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
  ('Замес'), ('Автолиз'), ('Брожение'), ('Обминка'), ('Деление'), ('Формовка'),
  ('Расстойка'), ('Ламинирование'), ('Выпечка'), ('Охлаждение'), ('Сборка'),
  ('Отделка'), ('Заморозка'), ('Упаковка'), ('Другое')
) AS s(name)
ON CONFLICT DO NOTHING;

-- Data migration: convert each recipe's old flat process columns into
-- stages + parameters in the new model, one stage per former field group,
-- so no existing techcard data is lost.

-- Замес
INSERT INTO "recipe_stages" ("id", "recipeId", "stageTypeId", "sequence", "note")
SELECT md5(r."id" || ':stage:Замес'), r."id", st."id", 1, NULL
FROM "recipes" r
JOIN "recipe_stage_types" st ON st."organizationId" = r."organizationId" AND st."name" = 'Замес'
WHERE r."mixingTimeSlowMinutes" IS NOT NULL OR r."mixingTimeFastMinutes" IS NOT NULL OR r."doughTempC" IS NOT NULL;

INSERT INTO "recipe_stage_parameters" ("id", "stageId", "kind", "label", "value")
SELECT md5(r."id" || ':param:Замес:slow'), md5(r."id" || ':stage:Замес'), 'DURATION_MINUTES', 'медленно', r."mixingTimeSlowMinutes"
FROM "recipes" r WHERE r."mixingTimeSlowMinutes" IS NOT NULL;

INSERT INTO "recipe_stage_parameters" ("id", "stageId", "kind", "label", "value")
SELECT md5(r."id" || ':param:Замес:fast'), md5(r."id" || ':stage:Замес'), 'DURATION_MINUTES', 'быстро', r."mixingTimeFastMinutes"
FROM "recipes" r WHERE r."mixingTimeFastMinutes" IS NOT NULL;

INSERT INTO "recipe_stage_parameters" ("id", "stageId", "kind", "label", "value")
SELECT md5(r."id" || ':param:Замес:temp'), md5(r."id" || ':stage:Замес'), 'TEMPERATURE_C', NULL, r."doughTempC"
FROM "recipes" r WHERE r."doughTempC" IS NOT NULL;

-- Брожение
INSERT INTO "recipe_stages" ("id", "recipeId", "stageTypeId", "sequence", "note")
SELECT md5(r."id" || ':stage:Брожение'), r."id", st."id", 2, NULL
FROM "recipes" r
JOIN "recipe_stage_types" st ON st."organizationId" = r."organizationId" AND st."name" = 'Брожение'
WHERE r."fermentationMinutes" IS NOT NULL;

INSERT INTO "recipe_stage_parameters" ("id", "stageId", "kind", "label", "value")
SELECT md5(r."id" || ':param:Брожение:time'), md5(r."id" || ':stage:Брожение'), 'DURATION_MINUTES', NULL, r."fermentationMinutes"
FROM "recipes" r WHERE r."fermentationMinutes" IS NOT NULL;

-- Формовка
INSERT INTO "recipe_stages" ("id", "recipeId", "stageTypeId", "sequence", "note")
SELECT md5(r."id" || ':stage:Формовка'), r."id", st."id", 3, NULL
FROM "recipes" r
JOIN "recipe_stage_types" st ON st."organizationId" = r."organizationId" AND st."name" = 'Формовка'
WHERE r."shapingWeightG" IS NOT NULL;

INSERT INTO "recipe_stage_parameters" ("id", "stageId", "kind", "label", "value")
SELECT md5(r."id" || ':param:Формовка:weight'), md5(r."id" || ':stage:Формовка'), 'WEIGHT_G', NULL, r."shapingWeightG"
FROM "recipes" r WHERE r."shapingWeightG" IS NOT NULL;

-- Расстойка
INSERT INTO "recipe_stages" ("id", "recipeId", "stageTypeId", "sequence", "note")
SELECT md5(r."id" || ':stage:Расстойка'), r."id", st."id", 4, NULL
FROM "recipes" r
JOIN "recipe_stage_types" st ON st."organizationId" = r."organizationId" AND st."name" = 'Расстойка'
WHERE r."proofingMinutes" IS NOT NULL OR r."proofingTempC" IS NOT NULL OR r."proofingHumidityPercent" IS NOT NULL;

INSERT INTO "recipe_stage_parameters" ("id", "stageId", "kind", "label", "value")
SELECT md5(r."id" || ':param:Расстойка:time'), md5(r."id" || ':stage:Расстойка'), 'DURATION_MINUTES', NULL, r."proofingMinutes"
FROM "recipes" r WHERE r."proofingMinutes" IS NOT NULL;

INSERT INTO "recipe_stage_parameters" ("id", "stageId", "kind", "label", "value")
SELECT md5(r."id" || ':param:Расстойка:temp'), md5(r."id" || ':stage:Расстойка'), 'TEMPERATURE_C', NULL, r."proofingTempC"
FROM "recipes" r WHERE r."proofingTempC" IS NOT NULL;

INSERT INTO "recipe_stage_parameters" ("id", "stageId", "kind", "label", "value")
SELECT md5(r."id" || ':param:Расстойка:humidity'), md5(r."id" || ':stage:Расстойка'), 'PERCENT', 'влажность', r."proofingHumidityPercent"
FROM "recipes" r WHERE r."proofingHumidityPercent" IS NOT NULL;

-- Выпечка
INSERT INTO "recipe_stages" ("id", "recipeId", "stageTypeId", "sequence", "note")
SELECT md5(r."id" || ':stage:Выпечка'), r."id", st."id", 5, NULL
FROM "recipes" r
JOIN "recipe_stage_types" st ON st."organizationId" = r."organizationId" AND st."name" = 'Выпечка'
WHERE r."bakingTempC" IS NOT NULL OR r."bakingTimeMinutes" IS NOT NULL OR r."steamSeconds" IS NOT NULL;

INSERT INTO "recipe_stage_parameters" ("id", "stageId", "kind", "label", "value")
SELECT md5(r."id" || ':param:Выпечка:temp'), md5(r."id" || ':stage:Выпечка'), 'TEMPERATURE_C', NULL, r."bakingTempC"
FROM "recipes" r WHERE r."bakingTempC" IS NOT NULL;

INSERT INTO "recipe_stage_parameters" ("id", "stageId", "kind", "label", "value")
SELECT md5(r."id" || ':param:Выпечка:time'), md5(r."id" || ':stage:Выпечка'), 'DURATION_MINUTES', NULL, r."bakingTimeMinutes"
FROM "recipes" r WHERE r."bakingTimeMinutes" IS NOT NULL;

INSERT INTO "recipe_stage_parameters" ("id", "stageId", "kind", "label", "value")
SELECT md5(r."id" || ':param:Выпечка:steam'), md5(r."id" || ':stage:Выпечка'), 'DURATION_MINUTES', 'пар', ROUND(r."steamSeconds" / 60.0, 2)
FROM "recipes" r WHERE r."steamSeconds" IS NOT NULL;

-- Migrate any existing free-text steps into "Другое" stages (in this repo's
-- data there are none yet, but this protects any real recipe data already
-- entered before this migration runs).
INSERT INTO "recipe_stages" ("id", "recipeId", "stageTypeId", "sequence", "note")
SELECT md5(s."id" || ':stage'), s."recipeId", st."id", 5 + s."sequence", s."instruction"
FROM "recipe_steps" s
JOIN "recipes" r ON r."id" = s."recipeId"
JOIN "recipe_stage_types" st ON st."organizationId" = r."organizationId" AND st."name" = 'Другое';

INSERT INTO "recipe_stage_parameters" ("id", "stageId", "kind", "label", "value")
SELECT md5(s."id" || ':param:duration'), md5(s."id" || ':stage'), 'DURATION_MINUTES', NULL, s."durationMinutes"
FROM "recipe_steps" s WHERE s."durationMinutes" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "recipe_steps" DROP CONSTRAINT "recipe_steps_recipeId_fkey";

-- AlterTable
ALTER TABLE "recipes" DROP COLUMN "bakingTempC",
DROP COLUMN "bakingTimeMinutes",
DROP COLUMN "doughTempC",
DROP COLUMN "fermentationMinutes",
DROP COLUMN "mixingTimeFastMinutes",
DROP COLUMN "mixingTimeSlowMinutes",
DROP COLUMN "proofingHumidityPercent",
DROP COLUMN "proofingMinutes",
DROP COLUMN "proofingTempC",
DROP COLUMN "shapingWeightG",
DROP COLUMN "steamSeconds";

-- DropTable
DROP TABLE "recipe_steps";
