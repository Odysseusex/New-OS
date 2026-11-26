-- Baker note numbers restart every day: unique per organization and day instead of per organization.
DROP INDEX "baker_notes_organizationId_number_key";
CREATE UNIQUE INDEX "baker_notes_organizationId_day_number_key" ON "baker_notes"("organizationId", "day", "number");
