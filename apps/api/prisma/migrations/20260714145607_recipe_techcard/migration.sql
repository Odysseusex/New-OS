-- AlterTable
ALTER TABLE "recipes" ADD COLUMN     "bakingTempC" DECIMAL(6,2),
ADD COLUMN     "bakingTimeMinutes" INTEGER,
ADD COLUMN     "fermentationMinutes" INTEGER,
ADD COLUMN     "generalNotes" TEXT,
ADD COLUMN     "lossPercent" DECIMAL(5,2),
ADD COLUMN     "proofingMinutes" INTEGER,
ADD COLUMN     "shelfLifeDays" INTEGER;

-- CreateTable
CREATE TABLE "recipe_steps" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "instruction" TEXT NOT NULL,
    "durationMinutes" INTEGER,

    CONSTRAINT "recipe_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_revisions" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT NOT NULL,

    CONSTRAINT "recipe_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipe_steps_recipeId_idx" ON "recipe_steps"("recipeId");

-- CreateIndex
CREATE INDEX "recipe_revisions_recipeId_idx" ON "recipe_revisions"("recipeId");

-- AddForeignKey
ALTER TABLE "recipe_steps" ADD CONSTRAINT "recipe_steps_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_revisions" ADD CONSTRAINT "recipe_revisions_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_revisions" ADD CONSTRAINT "recipe_revisions_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

