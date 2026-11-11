ALTER TABLE "Workspace"
 ADD COLUMN "invitationBatchSize" INTEGER NOT NULL DEFAULT 20,
 ADD COLUMN "invitationHourlyLimit" INTEGER DEFAULT 60,
 ADD COLUMN "invitationWindowStartedAt" TIMESTAMP(3),
 ADD COLUMN "invitationWindowCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workspace" ADD CONSTRAINT workspace_invitation_limits_valid CHECK (
 "invitationBatchSize" BETWEEN 1 AND 500 AND ("invitationHourlyLimit" IS NULL OR "invitationHourlyLimit" BETWEEN 1 AND 10000)
 AND "invitationWindowCount" >= 0);
