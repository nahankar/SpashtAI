-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "words" INTEGER,
    "fillerRate" DOUBLE PRECISION,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SessionMetrics" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "totalLlmTokens" INTEGER NOT NULL DEFAULT 0,
    "totalLlmDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgTtft" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTtsDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTtsAudioDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgTtsTtfb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalEouDelay" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversationLatencyAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userWpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userFillerCount" INTEGER NOT NULL DEFAULT 0,
    "userFillerRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userAvgSentenceLength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userSpeakingTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userVocabDiversity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userResponseTimeAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistantWpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistantFillerCount" INTEGER NOT NULL DEFAULT 0,
    "assistantFillerRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistantAvgSentenceLength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistantSpeakingTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistantVocabDiversity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistantResponseTimeAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTurns" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SessionTranscript" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "conversationData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SessionMetrics_sessionId_key" ON "public"."SessionMetrics"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionTranscript_sessionId_key" ON "public"."SessionTranscript"("sessionId");

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionMetrics" ADD CONSTRAINT "SessionMetrics_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionTranscript" ADD CONSTRAINT "SessionTranscript_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
