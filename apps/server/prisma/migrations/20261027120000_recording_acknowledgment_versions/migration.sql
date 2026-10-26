-- Acknowledgment text changed (provider-neutral wording) under a new version. A run carries either the legacy
-- per-practice checkbox version or an acknowledgment version that the owner has actually accepted; any other
-- version is refused, so later wording changes need no further trigger change. Historical acceptances are untouched.
CREATE OR REPLACE FUNCTION enforce_interview_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Interview run configuration is immutable'; END IF;
  IF NEW."recordingConsentAt" IS NULL OR NEW."recordingConsentVersion" IS NULL
    OR NEW."voiceConfigSnapshot" IS NULL OR NEW."voiceConfigSnapshot"->>'backend' IS DISTINCT FROM 'pipeline-bedrock'
    OR NEW."voiceConfigSnapshot"->>'sttProvider' IS DISTINCT FROM 'transcribe'
    OR NEW."voiceConfigSnapshot"->>'ttsProvider' IS DISTINCT FROM 'polly' THEN
    RAISE EXCEPTION 'Interview voice requires recorded consent and the supported pipeline';
  END IF;
  IF NEW."recordingConsentVersion" <> 'interview-recording-1' AND NOT EXISTS (SELECT 1 FROM "RecordingAcknowledgment" k
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
