-- Segment-aware Elevate sessions. Existing turns remain legacy (no segment),
-- but gain a stable global sequence equal to their previous turn index.

CREATE TABLE "public"."SessionSegment" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "segmentIndex" INTEGER NOT NULL,
    "roomName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "recordingStartedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "activeDurationSec" INTEGER,
    "audioStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionSegment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."SessionTurn"
    ADD COLUMN "segmentId" TEXT,
    ADD COLUMN "localTurnIndex" INTEGER,
    ADD COLUMN "sequenceNo" INTEGER;

UPDATE "public"."SessionTurn"
SET "localTurnIndex" = "turnIndex", "sequenceNo" = "turnIndex";

ALTER TABLE "public"."SessionTurn"
    ALTER COLUMN "localTurnIndex" SET NOT NULL,
    ALTER COLUMN "sequenceNo" SET NOT NULL;

ALTER TABLE "public"."SessionRecording"
    ADD COLUMN "segmentId" TEXT,
    ADD COLUMN "contentHash" TEXT,
    ADD COLUMN "mimeType" TEXT;

CREATE UNIQUE INDEX "SessionSegment_sessionId_segmentIndex_key"
    ON "public"."SessionSegment"("sessionId", "segmentIndex");
CREATE INDEX "SessionSegment_sessionId_startedAt_idx"
    ON "public"."SessionSegment"("sessionId", "startedAt");
CREATE UNIQUE INDEX "SessionTurn_sessionId_sequenceNo_key"
    ON "public"."SessionTurn"("sessionId", "sequenceNo");
CREATE UNIQUE INDEX "SessionTurn_segmentId_localTurnIndex_key"
    ON "public"."SessionTurn"("segmentId", "localTurnIndex");
CREATE INDEX "SessionTurn_segmentId_idx"
    ON "public"."SessionTurn"("segmentId");
CREATE UNIQUE INDEX "SessionRecording_segmentId_key"
    ON "public"."SessionRecording"("segmentId");

ALTER TABLE "public"."SessionSegment"
    ADD CONSTRAINT "SessionSegment_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."SessionTurn"
    ADD CONSTRAINT "SessionTurn_segmentId_fkey"
    FOREIGN KEY ("segmentId") REFERENCES "public"."SessionSegment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "public"."SessionRecording"
    ADD CONSTRAINT "SessionRecording_segmentId_fkey"
    FOREIGN KEY ("segmentId") REFERENCES "public"."SessionSegment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
