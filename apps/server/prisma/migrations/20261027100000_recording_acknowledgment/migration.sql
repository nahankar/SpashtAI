-- One-time Interviews recording and AI-processing acknowledgment, plus per-practice consent provenance.
-- Additive. No acknowledgment rows are created for existing accounts; older runs keep NULL provenance.
CREATE TABLE "RecordingAcknowledgment" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "scope" TEXT[],
  "textHash" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecordingAcknowledgment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecordingAcknowledgment_userId_version_key" ON "RecordingAcknowledgment"("userId", "version");
ALTER TABLE "RecordingAcknowledgment" ADD CONSTRAINT "RecordingAcknowledgment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE FUNCTION immutable_recording_acknowledgment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Recording acknowledgments are append-only'; END $$;
CREATE TRIGGER "RecordingAcknowledgment_immutable" BEFORE UPDATE ON "RecordingAcknowledgment"
FOR EACH ROW EXECUTE FUNCTION immutable_recording_acknowledgment();

ALTER TABLE "InterviewRun" ADD COLUMN "recordingConsentSource" TEXT;
ALTER TABLE "InterviewRun" ADD COLUMN "recordingAcknowledgmentId" TEXT;

-- Same run rules as before, extended: a run authorised by the account acknowledgment must reference that
-- owner's acknowledgment row for the same version; the per-practice checkbox keeps 'interview-recording-1'.
CREATE OR REPLACE FUNCTION enforce_interview_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Interview run configuration is immutable'; END IF;
  IF NEW."recordingConsentAt" IS NULL OR NEW."recordingConsentVersion" IS NULL
    OR NEW."recordingConsentVersion" NOT IN ('interview-recording-1', 'interview-recording-ai-1')
    OR NEW."voiceConfigSnapshot" IS NULL OR NEW."voiceConfigSnapshot"->>'backend' IS DISTINCT FROM 'pipeline-bedrock'
    OR NEW."voiceConfigSnapshot"->>'sttProvider' IS DISTINCT FROM 'transcribe'
    OR NEW."voiceConfigSnapshot"->>'ttsProvider' IS DISTINCT FROM 'polly' THEN
    RAISE EXCEPTION 'Interview voice requires recorded consent and the supported pipeline';
  END IF;
  IF NEW."recordingConsentVersion" = 'interview-recording-ai-1' AND NOT EXISTS (SELECT 1 FROM "RecordingAcknowledgment" k
    WHERE k.id=NEW."recordingAcknowledgmentId" AND k."userId"=NEW."ownerId" AND k.version=NEW."recordingConsentVersion") THEN
    RAISE EXCEPTION 'An acknowledgment-authorised interview must reference the owner''s acknowledgment';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Session" s WHERE s.id=NEW."sessionId" AND s."userId"=NEW."ownerId"
    AND s.purpose='INTERVIEW' AND s."contextScope"='SESSION_ONLY' AND s.module='elevate'
    AND s."discardedAt" IS NULL AND s."endedAt" IS NULL) THEN
    RAISE EXCEPTION 'Interview run must own a writable standalone interview session';
  END IF;
  RETURN NEW;
END $$;
