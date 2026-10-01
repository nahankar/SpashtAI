-- Users may keep one unfinished session open past the 24h inactivity sweep.
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "retainedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Session_userId_retainedAt_idx" ON "Session"("userId", "retainedAt");
