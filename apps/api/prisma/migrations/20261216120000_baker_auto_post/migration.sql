-- «Проводить накладные пекарей сразу» (off until switched on), documents and corrections of a posted note. Additive.
ALTER TABLE "organizations" ADD COLUMN "bakerAutoPostSince" TIMESTAMP(3),
  ADD COLUMN "bakerAutoPostDelayMinutes" INTEGER NOT NULL DEFAULT 10;

ALTER TABLE "baker_notes" ADD COLUMN "contentChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "autoPostFailedAt" TIMESTAMP(3);
UPDATE "baker_notes" SET "contentChangedAt" = "updatedAt";

CREATE TABLE "baker_note_documents" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "baker_note_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "baker_note_documents_noteId_idx" ON "baker_note_documents"("noteId");
ALTER TABLE "baker_note_documents" ADD CONSTRAINT "baker_note_documents_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "baker_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "baker_note_revisions" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "baker_note_revisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "baker_note_revisions_noteId_idx" ON "baker_note_revisions"("noteId");
ALTER TABLE "baker_note_revisions" ADD CONSTRAINT "baker_note_revisions_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "baker_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
