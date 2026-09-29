-- Prepare-owned activities retain their native engines internally, while their
-- user-visible home is the interview journey.
CREATE TABLE "PreparationRecording" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "stageId" TEXT,
    "replaySessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreparationRecording_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PreparationRecording_replaySessionId_key" ON "PreparationRecording"("replaySessionId");
CREATE INDEX "PreparationRecording_preparationId_createdAt_idx" ON "PreparationRecording"("preparationId", "createdAt");
CREATE INDEX "PreparationRecording_stageId_idx" ON "PreparationRecording"("stageId");

ALTER TABLE "PreparationRecording" ADD CONSTRAINT "PreparationRecording_preparationId_fkey"
  FOREIGN KEY ("preparationId") REFERENCES "Preparation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreparationRecording" ADD CONSTRAINT "PreparationRecording_stageId_fkey"
  FOREIGN KEY ("stageId") REFERENCES "PreparationStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PreparationRecording" ADD CONSTRAINT "PreparationRecording_replaySessionId_fkey"
  FOREIGN KEY ("replaySessionId") REFERENCES "ReplaySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReplayDeletion" (
    "id" TEXT NOT NULL,
    "replaySessionId" TEXT NOT NULL,
    "filePaths" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplayDeletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReplayDeletion_replaySessionId_key" ON "ReplayDeletion"("replaySessionId");
CREATE INDEX "ReplayDeletion_status_nextAttemptAt_idx" ON "ReplayDeletion"("status", "nextAttemptAt");

-- Journey-owned work is event-specific, so any historical global Pulse rows
-- must not influence future trends after this rollout.
DELETE FROM "ProgressPulse" AS pulse
WHERE (pulse.source = 'elevate' AND EXISTS (
  SELECT 1 FROM "PreparationPractice" practice WHERE practice."sessionId" = pulse."sessionId"
)) OR (pulse.source = 'replay' AND EXISTS (
  SELECT 1 FROM "PreparationRecording" recording WHERE recording."replaySessionId" = pulse."sessionId"
));
