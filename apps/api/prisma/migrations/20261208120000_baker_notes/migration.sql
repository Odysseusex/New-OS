-- CreateEnum
CREATE TYPE "BakerNoteKind" AS ENUM ('DELIVERY', 'FRIDGE');

-- CreateEnum
CREATE TYPE "BakerNoteStatus" AS ENUM ('SENT', 'POSTING', 'POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "bakerNoteSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "baker_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" "BakerNoteKind" NOT NULL DEFAULT 'DELIVERY',
    "status" "BakerNoteStatus" NOT NULL DEFAULT 'SENT',
    "day" TIMESTAMP(3) NOT NULL,
    "sourceLocationId" TEXT NOT NULL,
    "customerId" TEXT,
    "locationId" TEXT,
    "comment" TEXT,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "postedById" TEXT,
    "postedByName" TEXT,
    "postedAt" TIMESTAMP(3),
    "postingStartedAt" TIMESTAMP(3),
    "postError" TEXT,
    "saleId" TEXT,
    "requisitionId" TEXT,
    "documentLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "baker_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baker_note_lines" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "baker_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "baker_notes_organizationId_sourceLocationId_day_idx" ON "baker_notes"("organizationId", "sourceLocationId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "baker_notes_organizationId_number_key" ON "baker_notes"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "baker_note_lines_noteId_productId_key" ON "baker_note_lines"("noteId", "productId");

-- AddForeignKey
ALTER TABLE "baker_notes" ADD CONSTRAINT "baker_notes_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baker_notes" ADD CONSTRAINT "baker_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baker_notes" ADD CONSTRAINT "baker_notes_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baker_note_lines" ADD CONSTRAINT "baker_note_lines_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "baker_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "baker_note_lines" ADD CONSTRAINT "baker_note_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A delivery goes to exactly one target (a point or a wholesale customer); the fridge note to none.
ALTER TABLE "baker_notes" ADD CONSTRAINT "baker_notes_target"
  CHECK (("kind" = 'FRIDGE' AND "customerId" IS NULL AND "locationId" IS NULL)
      OR ("kind" = 'DELIVERY' AND (("customerId" IS NULL) <> ("locationId" IS NULL))));

-- One «Холодильник на завтра» per workshop and day.
CREATE UNIQUE INDEX "baker_notes_one_fridge" ON "baker_notes"("organizationId", "sourceLocationId", "day")
  WHERE "kind" = 'FRIDGE' AND "status" <> 'CANCELLED';
