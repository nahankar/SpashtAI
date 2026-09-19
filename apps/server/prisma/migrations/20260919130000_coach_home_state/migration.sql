ALTER TABLE "CoachThread" ADD COLUMN "focusArea" TEXT;

CREATE INDEX "CoachThread_userId_focusArea_idx"
ON "CoachThread"("userId", "focusArea");

CREATE INDEX "CoachThread_userId_status_updatedAt_idx"
ON "CoachThread"("userId", "status", "updatedAt");

CREATE INDEX "Session_userId_module_endedAt_idx"
ON "Session"("userId", "module", "endedAt");

CREATE INDEX "ReplaySession_userId_status_createdAt_idx"
ON "ReplaySession"("userId", "status", "createdAt");

CREATE TABLE "CoachHomeResultReceipt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CoachHomeResultReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoachHomeResultReceipt_userId_module_targetId_key"
ON "CoachHomeResultReceipt"("userId", "module", "targetId");

CREATE INDEX "CoachHomeResultReceipt_userId_seenAt_idx"
ON "CoachHomeResultReceipt"("userId", "seenAt");

ALTER TABLE "CoachHomeResultReceipt"
ADD CONSTRAINT "CoachHomeResultReceipt_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Coach Home launches after this migration. Treat all pre-existing results as
-- already seen so users do not receive a backlog of historical recommendations.
INSERT INTO "CoachHomeResultReceipt" ("id", "userId", "module", "targetId", "seenAt")
SELECT
  'legacy_' || md5('elevate:' || s."userId" || ':' || s."id"),
  s."userId",
  'elevate',
  s."id",
  COALESCE(s."endedAt", CURRENT_TIMESTAMP)
FROM "Session" s
WHERE s."module" = 'elevate' AND s."endedAt" IS NOT NULL
ON CONFLICT ("userId", "module", "targetId") DO NOTHING;

INSERT INTO "CoachHomeResultReceipt" ("id", "userId", "module", "targetId", "seenAt")
SELECT
  'legacy_' || md5('replay:' || r."userId" || ':' || r."id"),
  r."userId",
  'replay',
  r."id",
  COALESCE(rr."createdAt", r."updatedAt")
FROM "ReplaySession" r
JOIN "ReplayResult" rr ON rr."replaySessionId" = r."id"
WHERE r."status" = 'completed'
ON CONFLICT ("userId", "module", "targetId") DO NOTHING;
