-- CreateEnum
CREATE TYPE "InterviewQuestionSource" AS ENUM ('ACTUAL_INTERVIEW', 'PRACTICE', 'USER_ENTERED', 'AI_SUGGESTED');

-- CreateEnum
CREATE TYPE "InterviewOutcome" AS ENUM ('PASSED', 'REJECTED', 'PENDING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InterviewRating" AS ENUM ('VERY_POOR', 'POOR', 'FAIR', 'GOOD', 'EXCELLENT');

-- CreateTable
CREATE TABLE "InterviewQuestion" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "stageId" TEXT,
    "questionText" TEXT NOT NULL,
    "source" "InterviewQuestionSource" NOT NULL DEFAULT 'ACTUAL_INTERVIEW',
    "category" TEXT,
    "topic" TEXT,
    "difficulty" TEXT,
    "notes" TEXT,
    "askedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageReflection" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "rating" "InterviewRating",
    "outcome" "InterviewOutcome",
    "wentWell" TEXT,
    "difficulties" TEXT,
    "surprisedBy" TEXT,
    "feedbackReceived" TEXT,
    "nextRoundHints" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StageReflection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewQuestion_preparationId_idx" ON "InterviewQuestion"("preparationId");

-- CreateIndex
CREATE INDEX "InterviewQuestion_preparationId_source_idx" ON "InterviewQuestion"("preparationId", "source");

-- CreateIndex
CREATE INDEX "InterviewQuestion_stageId_idx" ON "InterviewQuestion"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "StageReflection_stageId_key" ON "StageReflection"("stageId");

-- CreateIndex
CREATE INDEX "StageReflection_preparationId_idx" ON "StageReflection"("preparationId");

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "Preparation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PreparationStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageReflection" ADD CONSTRAINT "StageReflection_preparationId_fkey" FOREIGN KEY ("preparationId") REFERENCES "Preparation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageReflection" ADD CONSTRAINT "StageReflection_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PreparationStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
