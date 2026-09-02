-- AlterTable
ALTER TABLE "UserFeedback" ADD COLUMN "sessionId" TEXT,
ADD COLUMN "sessionUrl" TEXT,
ADD COLUMN "sessionModule" TEXT;

CREATE INDEX "UserFeedback_sessionId_idx" ON "UserFeedback"("sessionId");
