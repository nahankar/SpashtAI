-- AlterTable
ALTER TABLE "public"."Session" ADD COLUMN "recordingStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."SessionTurn" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "turnIndex" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "audioStart" DOUBLE PRECISION,
    "audioEnd" DOUBLE PRECISION,
    "words" JSONB,
    "metrics" JSONB,
    "score" JSONB,
    "coachNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SessionTurn_sessionId_turnIndex_key" ON "public"."SessionTurn"("sessionId", "turnIndex");

-- CreateIndex
CREATE INDEX "SessionTurn_sessionId_idx" ON "public"."SessionTurn"("sessionId");

-- AddForeignKey
ALTER TABLE "public"."SessionTurn" ADD CONSTRAINT "SessionTurn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
