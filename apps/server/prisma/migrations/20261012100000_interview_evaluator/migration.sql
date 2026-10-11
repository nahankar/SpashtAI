-- CreateEnum
CREATE TYPE "public"."InterviewAnswerSource" AS ENUM ('ADMIN_TEST', 'LIVE_ATTEMPT', 'RECORDING');

-- CreateTable
CREATE TABLE "public"."InterviewAnswerSnapshot" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "source" "public"."InterviewAnswerSource" NOT NULL DEFAULT 'ADMIN_TEST',
    "attemptId" TEXT,
    "recordingId" TEXT,
    "questionId" TEXT,
    "questionSnapshot" JSONB NOT NULL,
    "questionHash" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "answerHash" TEXT NOT NULL,
    "textSource" TEXT NOT NULL DEFAULT 'ADMIN_TYPED',
    "textRevision" INTEGER NOT NULL DEFAULT 1,
    "language" TEXT NOT NULL DEFAULT 'en',
    "assistance" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewAnswerSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InterviewAssessment" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "inputKey" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "errorCode" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "InterviewAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InterviewEvaluatorUsage" (
    "id" TEXT NOT NULL,
    "invocationKey" TEXT NOT NULL,
    "assessmentId" TEXT,
    "modelId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewEvaluatorUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewAnswerSnapshot_ownerId_createdAt_idx" ON "public"."InterviewAnswerSnapshot"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewAssessment_snapshotId_key" ON "public"."InterviewAssessment"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewAssessment_inputKey_key" ON "public"."InterviewAssessment"("inputKey");

-- CreateIndex
CREATE INDEX "InterviewAssessment_status_nextAt_idx" ON "public"."InterviewAssessment"("status", "nextAt");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewEvaluatorUsage_invocationKey_key" ON "public"."InterviewEvaluatorUsage"("invocationKey");

-- CreateIndex
CREATE INDEX "InterviewEvaluatorUsage_createdAt_modelId_idx" ON "public"."InterviewEvaluatorUsage"("createdAt", "modelId");

-- AddForeignKey
ALTER TABLE "public"."InterviewAnswerSnapshot" ADD CONSTRAINT "InterviewAnswerSnapshot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewAnswerSnapshot" ADD CONSTRAINT "InterviewAnswerSnapshot_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "public"."QuestionBankQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewAssessment" ADD CONSTRAINT "InterviewAssessment_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "public"."InterviewAnswerSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewEvaluatorUsage" ADD CONSTRAINT "InterviewEvaluatorUsage_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "public"."InterviewAssessment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Future sources cannot be used until their capture/ownership contracts exist.
CREATE TABLE "InterviewEvaluatorBudget" (
  scope TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scope,day), CHECK (used >= 0)
);
ALTER TABLE "InterviewAnswerSnapshot" ADD CONSTRAINT "InterviewAnswerSnapshot_admin_source"
CHECK (source = 'ADMIN_TEST' AND "attemptId" IS NULL AND "recordingId" IS NULL
  AND "textSource" = 'ADMIN_TYPED' AND "textRevision" = 1 AND language = 'en'
  AND assistance IN ('NONE', 'HINT', 'EXAMPLE'));
ALTER TABLE "InterviewAssessment" ADD CONSTRAINT "InterviewAssessment_job_state"
CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED') AND attempts BETWEEN 0 AND 3
  AND ((status = 'RUNNING') = ("leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL))
  AND (status <> 'COMPLETED' OR result IS NOT NULL));
ALTER TABLE "InterviewEvaluatorUsage" ADD CONSTRAINT "InterviewEvaluatorUsage_nonnegative"
CHECK ("inputTokens" >= 0 AND "outputTokens" >= 0 AND "latencyMs" >= 0);

CREATE FUNCTION freeze_interview_answer_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only the bank link can be cleared by deletion of its mutable question.
  IF (to_jsonb(NEW) - 'questionId') IS DISTINCT FROM (to_jsonb(OLD) - 'questionId')
    OR (NEW."questionId" IS DISTINCT FROM OLD."questionId" AND NEW."questionId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Graded answer snapshots are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InterviewAnswerSnapshot_immutable" BEFORE UPDATE ON "InterviewAnswerSnapshot"
FOR EACH ROW EXECUTE FUNCTION freeze_interview_answer_snapshot();

INSERT INTO "PlatformFeatureFlag" (feature,label,description,audience,hidden,disabled,enabled,"updatedAt")
VALUES ('interview_evaluator','Interview evaluator · Admin pilot',
 'Sample-answer evaluations, separate from voice and Pulse. Admin role and pilot access required.',
 'SELECTED_USERS',true,true,false,NOW()) ON CONFLICT (feature) DO NOTHING;
