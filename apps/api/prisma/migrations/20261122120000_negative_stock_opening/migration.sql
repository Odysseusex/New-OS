-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "stocktakes" ADD COLUMN     "opening" BOOLEAN NOT NULL DEFAULT false;

