CREATE TABLE "AdminAnalyticsQuery" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "planHash" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "refreshIntervalSec" INTEGER NOT NULL DEFAULT 60,
    "lastRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAnalyticsQuery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminAnalyticsQuery_adminId_planHash_key"
ON "AdminAnalyticsQuery"("adminId", "planHash");

CREATE INDEX "AdminAnalyticsQuery_adminId_pinned_lastRunAt_idx"
ON "AdminAnalyticsQuery"("adminId", "pinned", "lastRunAt");
