-- Product analytics contract. duration stays request latency.
-- engagementMs is active foreground time and starts at this release.

ALTER TABLE "FeatureUsage" ADD COLUMN "eventId" TEXT;
ALTER TABLE "FeatureUsage" ADD COLUMN "visitId" TEXT;
ALTER TABLE "FeatureUsage" ADD COLUMN "path" TEXT;
ALTER TABLE "FeatureUsage" ADD COLUMN "engagementMs" INTEGER;
ALTER TABLE "FeatureUsage" ADD COLUMN "outcome" TEXT;
ALTER TABLE "FeatureUsage" ADD COLUMN "schemaVersion" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "FeatureUsage_eventId_key" ON "FeatureUsage"("eventId");
CREATE INDEX "FeatureUsage_userId_timestamp_idx" ON "FeatureUsage"("userId", "timestamp");
CREATE INDEX "FeatureUsage_feature_timestamp_idx" ON "FeatureUsage"("feature", "timestamp");
CREATE INDEX "FeatureUsage_feature_action_timestamp_idx" ON "FeatureUsage"("feature", "action", "timestamp");

CREATE INDEX "User_role_pincode_idx" ON "User"("role", "pincode");
CREATE INDEX "User_role_gender_idx" ON "User"("role", "gender");
CREATE INDEX "User_role_state_idx" ON "User"("role", "state");

CREATE INDEX "ProgressPulse_recordedAt_idx" ON "ProgressPulse"("recordedAt");
CREATE INDEX "ProgressPulse_source_recordedAt_idx" ON "ProgressPulse"("source", "recordedAt");
