-- Additive upgrade. Defaults for new/unclassified sessions load no history.
CREATE TYPE "ActivityPurpose" AS ENUM ('COMMUNICATION', 'INTERVIEW', 'GOAL_PREPARATION');
CREATE TYPE "ContextScope" AS ENUM ('SESSION_ONLY', 'COMMUNICATION_PROFILE', 'JOURNEY', 'EXPLICIT_SOURCE');
CREATE TYPE "FeatureAudience" AS ENUM ('EVERYONE', 'SELECTED_USERS');

ALTER TABLE "Session"
  ADD COLUMN "purpose" "ActivityPurpose",
  ADD COLUMN "contextScope" "ContextScope",
  ADD COLUMN "communicationProfile" TEXT NOT NULL DEFAULT 'communication-v1',
  ADD COLUMN "configurationSnapshot" JSONB;
ALTER TABLE "ReplaySession"
  ADD COLUMN "purpose" "ActivityPurpose",
  ADD COLUMN "contextScope" "ContextScope",
  ADD COLUMN "communicationProfile" TEXT NOT NULL DEFAULT 'communication-v1',
  ADD COLUMN "configurationSnapshot" JSONB;

UPDATE "Session" s SET "purpose" = CASE WHEN EXISTS (
  SELECT 1 FROM "PreparationPractice" p WHERE p."sessionId" = s.id
) THEN 'INTERVIEW'::"ActivityPurpose" ELSE 'COMMUNICATION'::"ActivityPurpose" END,
"contextScope" = CASE WHEN EXISTS (
  SELECT 1 FROM "PreparationPractice" p WHERE p."sessionId" = s.id
) THEN 'JOURNEY'::"ContextScope" ELSE 'COMMUNICATION_PROFILE'::"ContextScope" END;
UPDATE "ReplaySession" s SET "purpose" = CASE WHEN EXISTS (
  SELECT 1 FROM "PreparationRecording" p WHERE p."replaySessionId" = s.id
) THEN 'INTERVIEW'::"ActivityPurpose" ELSE 'COMMUNICATION'::"ActivityPurpose" END,
"contextScope" = CASE WHEN EXISTS (
  SELECT 1 FROM "PreparationRecording" p WHERE p."replaySessionId" = s.id
) THEN 'JOURNEY'::"ContextScope" ELSE 'SESSION_ONLY'::"ContextScope" END;

ALTER TABLE "Session"
  ALTER COLUMN "purpose" SET DEFAULT 'COMMUNICATION', ALTER COLUMN "purpose" SET NOT NULL,
  ALTER COLUMN "contextScope" SET DEFAULT 'SESSION_ONLY', ALTER COLUMN "contextScope" SET NOT NULL;
ALTER TABLE "ReplaySession"
  ALTER COLUMN "purpose" SET DEFAULT 'COMMUNICATION', ALTER COLUMN "purpose" SET NOT NULL,
  ALTER COLUMN "contextScope" SET DEFAULT 'SESSION_ONLY', ALTER COLUMN "contextScope" SET NOT NULL;
CREATE INDEX "Session_userId_purpose_startedAt_idx" ON "Session" ("userId", "purpose", "startedAt");
CREATE INDEX "ReplaySession_userId_purpose_createdAt_idx" ON "ReplaySession" ("userId", "purpose", "createdAt");
-- Two users must not concurrently claim the same live room via different segments.
CREATE UNIQUE INDEX "SessionSegment_active_roomName_key" ON "SessionSegment" ("roomName") WHERE "endedAt" IS NULL;

ALTER TABLE "PlatformFeatureFlag" ADD COLUMN "audience" "FeatureAudience" NOT NULL DEFAULT 'EVERYONE';
CREATE TABLE "UserFeatureGrant" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "feature" TEXT NOT NULL REFERENCES "PlatformFeatureFlag"("feature") ON DELETE CASCADE ON UPDATE CASCADE,
  "grantedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "UserFeatureGrant_userId_feature_key" ON "UserFeatureGrant" ("userId", "feature");

-- Deferred checks let engine creation and ownership linking commit atomically.
-- Existing interview journeys remain INTERVIEW; extend this function with
-- journey-type-specific purpose when non-interview journeys are introduced.
CREATE FUNCTION check_activity_journey_policy() RETURNS trigger AS $$
DECLARE
  live_id TEXT;
  replay_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Session' THEN live_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'ReplaySession' THEN replay_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'PreparationPractice' THEN live_id := NEW."sessionId";
  ELSE replay_id := NEW."replaySessionId";
  END IF;
  IF EXISTS (SELECT 1 FROM "PreparationPractice" p JOIN "Session" s ON s.id=p."sessionId"
    JOIN "Preparation" j ON j.id=p."preparationId"
    WHERE s.id=live_id AND (s."purpose" <> 'INTERVIEW' OR s."contextScope" <> 'JOURNEY' OR s."userId" <> j."userId"))
    OR EXISTS (SELECT 1 FROM "PreparationRecording" p JOIN "ReplaySession" s ON s.id=p."replaySessionId"
    JOIN "Preparation" j ON j.id=p."preparationId"
    WHERE s.id=replay_id AND (s."purpose" <> 'INTERVIEW' OR s."contextScope" <> 'JOURNEY' OR s."userId" <> j."userId")) THEN
    RAISE EXCEPTION 'Journey activity purpose, context and ownership must agree';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "Session_journey_policy" AFTER INSERT OR UPDATE OF "purpose", "contextScope", "userId" ON "Session"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_activity_journey_policy();
CREATE CONSTRAINT TRIGGER "ReplaySession_journey_policy" AFTER INSERT OR UPDATE OF "purpose", "contextScope", "userId" ON "ReplaySession"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_activity_journey_policy();
CREATE CONSTRAINT TRIGGER "PreparationPractice_activity_policy" AFTER INSERT OR UPDATE ON "PreparationPractice"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_activity_journey_policy();
CREATE CONSTRAINT TRIGGER "PreparationRecording_activity_policy" AFTER INSERT OR UPDATE ON "PreparationRecording"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_activity_journey_policy();
