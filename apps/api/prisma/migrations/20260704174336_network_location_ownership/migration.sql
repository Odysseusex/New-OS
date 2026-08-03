-- CreateEnum
CREATE TYPE "LocationOwnership" AS ENUM ('OWNED', 'FRANCHISE');

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "ownership" "LocationOwnership" NOT NULL DEFAULT 'OWNED';
