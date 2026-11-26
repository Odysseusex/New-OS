-- CreateTable
CREATE TABLE "baker_note_prints" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "printedById" TEXT NOT NULL,
    "printedByName" TEXT NOT NULL,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "contentKey" TEXT NOT NULL,

    CONSTRAINT "baker_note_prints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "baker_note_prints_noteId_printedAt_idx" ON "baker_note_prints"("noteId", "printedAt");

-- CreateIndex
CREATE INDEX "baker_note_prints_organizationId_idx" ON "baker_note_prints"("organizationId");

-- AddForeignKey
ALTER TABLE "baker_note_prints" ADD CONSTRAINT "baker_note_prints_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "baker_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
