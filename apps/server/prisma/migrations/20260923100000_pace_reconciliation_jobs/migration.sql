ALTER TABLE "Session"
ADD COLUMN "paceReconciliationStatus" TEXT,
ADD COLUMN "paceReconciliationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "paceReconciliationError" TEXT,
ADD COLUMN "nextPaceReconciliationAt" TIMESTAMP(3),
ADD COLUMN "paceReconciliationLeaseId" TEXT,
ADD COLUMN "paceReconciliationLeaseUntil" TIMESTAMP(3);

CREATE INDEX "Session_paceReconciliationStatus_nextPaceReconciliationAt_idx"
ON "Session"("paceReconciliationStatus", "nextPaceReconciliationAt");

CREATE INDEX "Session_paceReconciliationStatus_paceReconciliationLeaseUntil_idx"
ON "Session"("paceReconciliationStatus", "paceReconciliationLeaseUntil");

-- Backfill every historical ended session once. Completed jobs are never
-- selected again; retries remain durable across deploys and process restarts.
UPDATE "Session"
SET
  "paceReconciliationStatus" = 'pending',
  "nextPaceReconciliationAt" = NOW()
WHERE "endedAt" IS NOT NULL
  AND "discardedAt" IS NULL
  AND "paceReconciliationStatus" IS NULL;
