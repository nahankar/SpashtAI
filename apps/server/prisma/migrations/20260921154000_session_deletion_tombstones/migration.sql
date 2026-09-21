ALTER TABLE "Session"
ADD COLUMN "discardedAt" TIMESTAMP(3),
ADD COLUMN "deletionStatus" TEXT,
ADD COLUMN "deletionAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "deletionError" TEXT,
ADD COLUMN "nextDeletionAttemptAt" TIMESTAMP(3);

CREATE INDEX "Session_discardedAt_nextDeletionAttemptAt_idx"
ON "Session"("discardedAt", "nextDeletionAttemptAt");
