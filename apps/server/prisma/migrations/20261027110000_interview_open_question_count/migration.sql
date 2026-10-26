-- New practices have no fixed question count: NULL maxQuestions means the practice runs until its time
-- expires (if it has one), the learner ends it, or eligible questions run out. Existing runs keep their
-- stored limit of 8, which stays enforced for every attempt they create.
ALTER TABLE "InterviewRun" ALTER COLUMN "maxQuestions" DROP NOT NULL;
ALTER TABLE "InterviewRun" ALTER COLUMN "maxQuestions" DROP DEFAULT;
ALTER TABLE "InterviewRun" DROP CONSTRAINT "InterviewRun_setup";
ALTER TABLE "InterviewRun" ADD CONSTRAINT "InterviewRun_setup" CHECK (
  namespace = 'automation-pilot'
  AND public.valid_interview_selection(track, ARRAY[]::TEXT[], 20, 160)
  AND public.valid_interview_selection("experienceBand", ARRAY['0-2','2-5','5-8','8+'], 4, 3)
  AND public.valid_interview_selection("startingDifficulty", ARRAY['Simple','Medium','Complex','Very Complex'], 4, 12)
  AND ("durationMinutes" IS NULL OR "durationMinutes" IN (5,10,15,30))
  AND ("maxQuestions" IS NULL OR "maxQuestions" = 8)
);

-- The attempt index is no longer capped at 8 by shape; the owning run's stored limit is enforced instead.
ALTER TABLE "InterviewAttempt" DROP CONSTRAINT "InterviewAttempt_state";
ALTER TABLE "InterviewAttempt" ADD CONSTRAINT "InterviewAttempt_state"
CHECK ("index" >= 1 AND origin='BANK' AND "parentAttemptId" IS NULL
  AND status IN ('PREPARED','ASKED','ANSWERED','SKIPPED','INCOMPLETE') AND assistance IN ('NONE','HINT','EXAMPLE')
  AND (status <> 'PREPARED' OR "askedAt" IS NULL)
  AND (status NOT IN ('ASKED','ANSWERED','SKIPPED') OR "askedAt" IS NOT NULL)
  AND ((status IN ('ANSWERED','SKIPPED','INCOMPLETE')) = ("completedAt" IS NOT NULL))
  AND ((status='INCOMPLETE') = ("completionReason" IS NOT NULL)));

CREATE OR REPLACE FUNCTION enforce_interview_question_limit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "InterviewRun" r WHERE r.id=NEW."runId" AND r."maxQuestions" IS NOT NULL AND NEW."index" > r."maxQuestions") THEN
    RAISE EXCEPTION 'Interview question limit reached for this practice';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InterviewAttempt_question_limit" BEFORE INSERT OR UPDATE OF "index", "runId" ON "InterviewAttempt"
FOR EACH ROW EXECUTE FUNCTION enforce_interview_question_limit();
