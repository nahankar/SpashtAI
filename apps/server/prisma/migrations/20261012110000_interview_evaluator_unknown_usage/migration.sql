-- Missing provider telemetry must remain unknown rather than appear as zero cost.
ALTER TABLE "InterviewEvaluatorUsage" ALTER COLUMN "inputTokens" DROP NOT NULL;
ALTER TABLE "InterviewEvaluatorUsage" ALTER COLUMN "inputTokens" DROP DEFAULT;
ALTER TABLE "InterviewEvaluatorUsage" ALTER COLUMN "outputTokens" DROP NOT NULL;
ALTER TABLE "InterviewEvaluatorUsage" ALTER COLUMN "outputTokens" DROP DEFAULT;
UPDATE "InterviewEvaluatorUsage" SET "inputTokens" = NULL, "outputTokens" = NULL
WHERE outcome NOT IN ('SUCCESS', 'INVALID_OUTPUT', 'INCOMPLETE_OUTPUT');
