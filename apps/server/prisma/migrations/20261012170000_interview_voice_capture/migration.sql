-- AlterTable
ALTER TABLE "public"."InterviewAttempt" ADD COLUMN     "completionReason" TEXT;

-- AlterTable
ALTER TABLE "public"."InterviewRun" ADD COLUMN     "recordingConsentAt" TIMESTAMP(3),
ADD COLUMN     "recordingConsentVersion" TEXT,
ADD COLUMN     "voiceConfigSnapshot" JSONB;

-- AlterTable
ALTER TABLE "public"."SessionSegment" ADD COLUMN     "interviewDrainAttemptId" TEXT,
ADD COLUMN     "interviewDrainUntil" TIMESTAMP(3),
ADD COLUMN     "interviewDrainedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."InterviewCaptureReceipt" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "lastTurnIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewCaptureReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewCaptureReceipt_attemptId_action_idx" ON "public"."InterviewCaptureReceipt"("attemptId", "action");

-- AddForeignKey
ALTER TABLE "public"."InterviewCaptureReceipt" ADD CONSTRAINT "InterviewCaptureReceipt_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "public"."InterviewAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewCaptureReceipt" ADD CONSTRAINT "InterviewCaptureReceipt_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "public"."SessionSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO "PlatformFeatureFlag" (feature,label,description,audience,hidden,disabled,enabled,"updatedAt")
VALUES ('interview_voice','Interview voice · learner pilot','Technical interview voice capture pilot; requires Interviews access and an individual grant.','SELECTED_USERS',true,true,false,NOW())
ON CONFLICT (feature) DO NOTHING;

ALTER TABLE "InterviewAttempt" DROP CONSTRAINT "InterviewAttempt_state";
ALTER TABLE "InterviewAttempt" ADD CONSTRAINT "InterviewAttempt_state"
CHECK ("index" BETWEEN 1 AND 8 AND origin='BANK' AND "parentAttemptId" IS NULL
  AND status IN ('PREPARED','ASKED','ANSWERED','SKIPPED','INCOMPLETE') AND assistance IN ('NONE','HINT','EXAMPLE')
  AND (status <> 'PREPARED' OR "askedAt" IS NULL)
  AND (status NOT IN ('ASKED','ANSWERED','SKIPPED') OR "askedAt" IS NOT NULL)
  AND ((status IN ('ANSWERED','SKIPPED','INCOMPLETE')) = ("completedAt" IS NOT NULL))
  AND ((status='INCOMPLETE') = ("completionReason" IS NOT NULL)));
ALTER TABLE "SessionSegment" ADD CONSTRAINT "SessionSegment_interview_drain"
CHECK (("interviewDrainUntil" IS NULL) = ("interviewDrainAttemptId" IS NULL)
  AND ("interviewDrainUntil" IS NULL OR ("endedAt" IS NOT NULL AND "interviewDrainedAt" IS NULL)));
ALTER TABLE "InterviewCaptureReceipt" ADD CONSTRAINT "InterviewCaptureReceipt_action"
CHECK (action IN ('FINISH','SKIP','PAUSE','LEAVE') AND "lastTurnIndex">=-1);

CREATE OR REPLACE FUNCTION preserve_interview_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-ARRAY['questionId','status','assistance','askedAt','completedAt','completionReason']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['questionId','status','assistance','askedAt','completedAt','completionReason'])
    OR (NEW."questionId" IS DISTINCT FROM OLD."questionId" AND NEW."questionId" IS NOT NULL)
    OR (NEW.status<>OLD.status AND NOT ((OLD.status='PREPARED' AND NEW.status IN ('ASKED','INCOMPLETE'))
      OR (OLD.status='ASKED' AND NEW.status IN ('ANSWERED','SKIPPED','INCOMPLETE'))))
    OR (OLD."askedAt" IS NOT NULL AND NEW."askedAt" IS DISTINCT FROM OLD."askedAt")
    OR (OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt")
    OR (OLD."completionReason" IS NOT NULL AND NEW."completionReason" IS DISTINCT FROM OLD."completionReason")
    OR (OLD.status IN ('ANSWERED','SKIPPED','INCOMPLETE') AND NEW.assistance<>OLD.assistance)
    OR (OLD.assistance='EXAMPLE' AND NEW.assistance<>'EXAMPLE') OR (OLD.assistance='HINT' AND NEW.assistance='NONE') THEN
    RAISE EXCEPTION 'Interview question and committed attempt are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION close_incomplete_interview_attempts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."endedAt" IS NULL AND NEW."endedAt" IS NOT NULL THEN
    UPDATE "InterviewAttempt" a SET status='INCOMPLETE', "completedAt"=NOW(), "completionReason"='SESSION_ENDED'
      FROM "InterviewRun" r WHERE r.id=a."runId" AND r."sessionId"=NEW.id AND a.status IN ('PREPARED','ASKED');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Session_complete_interview_attempts" BEFORE UPDATE OF "endedAt" ON "Session"
FOR EACH ROW EXECUTE FUNCTION close_incomplete_interview_attempts();

CREATE FUNCTION bound_interview_segment_drain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt_id TEXT;
BEGIN
  IF OLD."interviewDrainedAt" IS NOT NULL AND NEW."interviewDrainedAt" IS DISTINCT FROM OLD."interviewDrainedAt" THEN
    RAISE EXCEPTION 'Drained speech segments cannot reopen';
  END IF;
  IF OLD."interviewDrainUntil" IS NOT NULL AND NEW."interviewDrainUntil">OLD."interviewDrainUntil" THEN
    RAISE EXCEPTION 'The speech drain deadline cannot be extended';
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
CREATE TRIGGER "SessionSegment_bound_interview_drain" BEFORE UPDATE OF "endedAt","interviewDrainedAt","interviewDrainUntil","interviewDrainAttemptId"
ON "SessionSegment" FOR EACH ROW EXECUTE FUNCTION bound_interview_segment_drain();

CREATE OR REPLACE FUNCTION enforce_interview_chunk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Committed speech chunks are immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "InterviewAttempt" a JOIN "InterviewRun" r ON r.id=a."runId"
    JOIN "Session" s ON s.id=r."sessionId" JOIN "SessionSegment" g ON g."sessionId"=s.id
    WHERE a.id=NEW."attemptId" AND a.status='ASKED' AND g.id=NEW."segmentId" AND g."interviewDrainedAt" IS NULL
      AND (g."endedAt" IS NULL OR (g."interviewDrainAttemptId"=a.id AND g."interviewDrainUntil">NOW()))
      AND s."endedAt" IS NULL AND s."discardedAt" IS NULL)
    OR EXISTS (SELECT 1 FROM "InterviewCaptureReceipt" c WHERE c."attemptId"=NEW."attemptId"
      AND c."segmentId"=NEW."segmentId" AND c.action IN ('FINISH','SKIP')) THEN
    RAISE EXCEPTION 'Speech must belong to the unfinished attempt and its open or bounded-draining segment';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION enforce_interview_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_state RECORD; last_index INTEGER;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Speech-save receipts are immutable'; END IF;
  SELECT a.status,a."runId",r."sessionId",s."discardedAt",s."endedAt" AS session_end,g."endedAt" AS segment_end,
    g."interviewDrainedAt",g."interviewDrainUntil",g."interviewDrainAttemptId" INTO row_state
    FROM "InterviewAttempt" a JOIN "InterviewRun" r ON r.id=a."runId" JOIN "Session" s ON s.id=r."sessionId"
    JOIN "SessionSegment" g ON g."sessionId"=s.id WHERE a.id=NEW."attemptId" AND g.id=NEW."segmentId";
  IF NOT FOUND OR row_state."discardedAt" IS NOT NULL OR row_state.session_end IS NOT NULL
    OR row_state."interviewDrainedAt" IS NOT NULL OR row_state.status NOT IN ('ASKED','ANSWERED','SKIPPED')
    OR (NEW.action IN ('FINISH','SKIP') AND row_state.status<>'ASKED')
    OR (row_state.segment_end IS NOT NULL AND (row_state."interviewDrainAttemptId" IS DISTINCT FROM NEW."attemptId"
      OR row_state."interviewDrainUntil" IS NULL OR row_state."interviewDrainUntil"<=NOW())) THEN
    RAISE EXCEPTION 'Speech-save receipt must own a writable interview segment';
  END IF;
  SELECT COALESCE(MAX("localTurnIndex"),-1) INTO last_index FROM "InterviewAnswerChunk" WHERE "segmentId"=NEW."segmentId";
  IF last_index<>NEW."lastTurnIndex" THEN RAISE EXCEPTION 'Speech-save receipt must include every persisted turn'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InterviewCaptureReceipt_owner" BEFORE INSERT OR UPDATE ON "InterviewCaptureReceipt"
FOR EACH ROW EXECUTE FUNCTION enforce_interview_receipt();
CREATE FUNCTION seal_interview_segment_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action IN ('PAUSE','LEAVE') THEN
    UPDATE "SessionSegment" SET "interviewDrainedAt"=NOW(),"interviewDrainUntil"=NULL,"interviewDrainAttemptId"=NULL WHERE id=NEW."segmentId";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InterviewCaptureReceipt_seal_segment" AFTER INSERT ON "InterviewCaptureReceipt"
FOR EACH ROW EXECUTE FUNCTION seal_interview_segment_receipt();

CREATE FUNCTION require_live_interview_finish_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source='LIVE_ATTEMPT' AND NOT EXISTS (SELECT 1 FROM "InterviewCaptureReceipt" WHERE "attemptId"=NEW."attemptId" AND action='FINISH') THEN
    RAISE EXCEPTION 'An authoritative live answer requires an agent speech-save receipt';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InterviewAnswerSnapshot_finish_receipt" BEFORE INSERT ON "InterviewAnswerSnapshot"
FOR EACH ROW EXECUTE FUNCTION require_live_interview_finish_receipt();

CREATE OR REPLACE FUNCTION enforce_interview_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Interview run configuration is immutable'; END IF;
  IF NEW."recordingConsentAt" IS NULL OR NEW."recordingConsentVersion" IS DISTINCT FROM 'interview-recording-1'
    OR NEW."voiceConfigSnapshot" IS NULL OR NEW."voiceConfigSnapshot"->>'backend' IS DISTINCT FROM 'pipeline-bedrock'
    OR NEW."voiceConfigSnapshot"->>'sttProvider' IS DISTINCT FROM 'transcribe'
    OR NEW."voiceConfigSnapshot"->>'ttsProvider' IS DISTINCT FROM 'polly' THEN
    RAISE EXCEPTION 'Interview voice requires recorded consent and the supported pipeline';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Session" s WHERE s.id=NEW."sessionId" AND s."userId"=NEW."ownerId"
    AND s.purpose='INTERVIEW' AND s."contextScope"='SESSION_ONLY' AND s.module='elevate'
    AND s."discardedAt" IS NULL AND s."endedAt" IS NULL) THEN
    RAISE EXCEPTION 'Interview run must own a writable standalone interview session';
  END IF;
  RETURN NEW;
END $$;
