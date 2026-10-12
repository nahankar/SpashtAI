-- Keep closed interview segments and their server-established drain binding closed.
-- This additive migration preserves the already tested voice-capture migration.
CREATE OR REPLACE FUNCTION bound_interview_segment_drain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt_id TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM "InterviewRun" WHERE "sessionId"=OLD."sessionId")
    AND OLD."endedAt" IS NOT NULL AND NEW."endedAt" IS NULL THEN
    RAISE EXCEPTION 'Closed interview speech segments cannot reopen';
  END IF;
  IF OLD."interviewDrainedAt" IS NOT NULL AND NEW."interviewDrainedAt" IS DISTINCT FROM OLD."interviewDrainedAt" THEN
    RAISE EXCEPTION 'Drained speech segments cannot reopen';
  END IF;
  IF OLD."interviewDrainUntil" IS NOT NULL THEN
    IF NEW."interviewDrainUntil">OLD."interviewDrainUntil"
      OR (NEW."interviewDrainedAt" IS NULL AND (NEW."interviewDrainUntil" IS NULL
        OR NEW."interviewDrainAttemptId" IS DISTINCT FROM OLD."interviewDrainAttemptId")) THEN
      RAISE EXCEPTION 'The speech drain deadline and attempt cannot be extended or rebound';
    END IF;
  END IF;
  IF OLD."endedAt" IS NULL AND NEW."endedAt" IS NOT NULL AND NEW."interviewDrainedAt" IS NULL THEN
    SELECT a.id INTO attempt_id FROM "InterviewAttempt" a JOIN "InterviewRun" r ON r.id=a."runId"
      JOIN "Session" s ON s.id=r."sessionId" WHERE r."sessionId"=NEW."sessionId" AND a.status='ASKED'
      AND s."endedAt" IS NULL AND s."discardedAt" IS NULL;
    IF attempt_id IS NOT NULL THEN
      NEW."interviewDrainAttemptId":=attempt_id; NEW."interviewDrainUntil":=NOW()+interval '30 seconds';
    END IF;
  END IF;
  RETURN NEW;
END $$;
