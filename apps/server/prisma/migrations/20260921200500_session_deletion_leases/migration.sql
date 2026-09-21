ALTER TABLE "Session"
ADD COLUMN "deletionLeaseId" TEXT,
ADD COLUMN "deletionLeaseUntil" TIMESTAMP(3);

CREATE INDEX "Session_discardedAt_deletionLeaseUntil_nextDeletionAttemptAt_idx"
ON "Session"("discardedAt", "deletionLeaseUntil", "nextDeletionAttemptAt");
