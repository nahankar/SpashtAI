-- Keep Coach goals attached to the interview journey they were created for.
CREATE INDEX "CoachThread_preparationId_idx" ON "CoachThread"("preparationId");

ALTER TABLE "CoachThread"
ADD CONSTRAINT "CoachThread_preparationId_fkey"
FOREIGN KEY ("preparationId") REFERENCES "Preparation"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
