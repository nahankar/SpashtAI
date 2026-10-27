-- Transcript-integrity events attached durably to the affected answer and segment. Append-only: a later
-- recognizer recovery is a new event and never clears an earlier confirmed gap. Lost time is detected speech
-- (never silence) and is an estimate; no missing words are claimed.
CREATE TABLE "InterviewTranscriptIssue" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "segmentId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "lostSpeechSeconds" DOUBLE PRECISION,
  "eventKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InterviewTranscriptIssue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InterviewTranscriptIssue_shape" CHECK (
    kind IN ('GAP','RECOGNITION_UNAVAILABLE','RECOGNITION_RECOVERED','UNCONFIRMED_ACCEPTED','NOISE_IGNORED')
    AND ((kind = 'GAP') = ("lostSpeechSeconds" IS NOT NULL))
    AND ("lostSpeechSeconds" IS NULL OR ("lostSpeechSeconds" > 0 AND "lostSpeechSeconds" <= 7200))
    AND length("eventKey") BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX "InterviewTranscriptIssue_attemptId_eventKey_key" ON "InterviewTranscriptIssue"("attemptId", "eventKey");
CREATE INDEX "InterviewTranscriptIssue_segmentId_idx" ON "InterviewTranscriptIssue"("segmentId");
ALTER TABLE "InterviewTranscriptIssue" ADD CONSTRAINT "InterviewTranscriptIssue_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "InterviewAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InterviewTranscriptIssue" ADD CONSTRAINT "InterviewTranscriptIssue_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "SessionSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_interview_transcript_issue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Transcript-integrity events are append-only'; END IF;
  -- The segment must belong to the same practice session as the attempt.
  IF NOT EXISTS (SELECT 1 FROM "InterviewAttempt" a JOIN "InterviewRun" r ON r.id = a."runId"
    JOIN "SessionSegment" g ON g."sessionId" = r."sessionId" WHERE a.id = NEW."attemptId" AND g.id = NEW."segmentId") THEN
    RAISE EXCEPTION 'Transcript-integrity event segment does not belong to the attempt''s practice';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InterviewTranscriptIssue_guard" BEFORE INSERT OR UPDATE ON "InterviewTranscriptIssue"
FOR EACH ROW EXECUTE FUNCTION enforce_interview_transcript_issue();

-- The integrity summary each saved answer was created with (part of its evaluation inputs). NULL on earlier answers.
ALTER TABLE "InterviewAnswerSnapshot" ADD COLUMN "transcriptIntegrity" JSONB;
