-- Prepare owns this association. Deleting a journey removes only the link;
-- deleting an Elevate session also removes its now-useless link.
CREATE TABLE "PreparationPractice" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "stageId" TEXT,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparationPractice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PreparationPractice_sessionId_key" ON "PreparationPractice"("sessionId");
CREATE INDEX "PreparationPractice_preparationId_createdAt_idx" ON "PreparationPractice"("preparationId", "createdAt");
CREATE INDEX "PreparationPractice_stageId_idx" ON "PreparationPractice"("stageId");

ALTER TABLE "PreparationPractice" ADD CONSTRAINT "PreparationPractice_preparationId_fkey"
  FOREIGN KEY ("preparationId") REFERENCES "Preparation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PreparationPractice" ADD CONSTRAINT "PreparationPractice_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "PreparationStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PreparationPractice" ADD CONSTRAINT "PreparationPractice_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
