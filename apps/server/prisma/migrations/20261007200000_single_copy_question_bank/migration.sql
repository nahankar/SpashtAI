BEGIN;
-- CreateTable
CREATE TABLE "public"."QuestionBankQuestion" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "externalQid" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "questionText" TEXT NOT NULL,
    "track" TEXT NOT NULL DEFAULT 'General',
    "category" TEXT NOT NULL DEFAULT 'General',
    "topic" TEXT NOT NULL DEFAULT 'General',
    "difficulty" TEXT NOT NULL DEFAULT 'Medium',
    "experienceBand" TEXT NOT NULL DEFAULT '2-5',
    "frequency" TEXT NOT NULL DEFAULT 'Core',
    "questionType" TEXT NOT NULL DEFAULT 'Technical',
    "roleArchetype" TEXT NOT NULL DEFAULT 'IC',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trendNote" TEXT NOT NULL DEFAULT '',
    "sourceFile" TEXT,
    "sourceSheet" TEXT,
    "sourceAnswer" TEXT,
    "sourceQuestionText" TEXT,
    "importHash" TEXT,
    "explanation" TEXT NOT NULL DEFAULT '',
    "exampleAnswer" TEXT NOT NULL DEFAULT '',
    "goodAnswerPoints" TEXT NOT NULL DEFAULT '',
    "followUpGuidance" TEXT NOT NULL DEFAULT '',
    "verbalSuitable" BOOLEAN NOT NULL DEFAULT true,
    "expectedDepth" TEXT NOT NULL DEFAULT 'Explain your reasoning and give a practical example.',
    "referenceSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewNotes" TEXT NOT NULL DEFAULT '',
    "generationNotes" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "originKey" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionBankQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BankFollowUpJob" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BankFollowUpJob_pkey" PRIMARY KEY ("id")
);

-- Preserve the latest editable copy for each QID and convert existing rubric
-- points to plain answer guidance. Older copies are intentionally consolidated.
CREATE TEMP TABLE bank_copy_map ON COMMIT DROP AS
SELECT DISTINCT ON (i.id) i.id AS "itemId", v.id AS "copyId", i.namespace, i."externalQid"
FROM "QuestionBankItem" i JOIN "QuestionBankVersion" v ON v."questionId" = i.id
ORDER BY i.id, v.version DESC;
INSERT INTO "QuestionBankQuestion" (
 "id","namespace","externalQid","revision","approved","active","questionText",
 "track","category","topic","difficulty","experienceBand","frequency","questionType","roleArchetype","tags","trendNote",
 "sourceFile","sourceSheet","sourceAnswer","sourceQuestionText","importHash","explanation","exampleAnswer","goodAnswerPoints",
 "verbalSuitable","expectedDepth","referenceSources","generationNotes","origin","createdById","approvedById","approvedAt","createdAt","updatedAt")
SELECT v.id,m.namespace,m."externalQid",v.revision,v.status IN ('REVIEWED','PUBLISHED'),v.status='PUBLISHED',v."questionText",
 COALESCE(NULLIF(v.track,''),'General'),COALESCE(NULLIF(v.category,''),'General'),COALESCE(NULLIF(v.topic,''),'General'),
 COALESCE(v.difficulty,'Medium'),COALESCE(v."experienceBand",'2-5'),COALESCE(v.frequency,'Core'),COALESCE(v."questionType",'Technical'),COALESCE(v."roleArchetype",'IC'),v.tags,COALESCE(v."trendNote",''),
 v."sourceFile",v."sourceSheet",v."sourceAnswer",v."sourceQuestionText",v."importHash",v.explanation,v."exampleAnswer",
 COALESCE((SELECT string_agg(p.point, E'\n') FROM jsonb_array_elements(s.rubric->'criteria') c CROSS JOIN LATERAL jsonb_array_elements_text(c->'points') p(point)),''),
 v."verbalSuitable",COALESCE(NULLIF(v."expectedDepth",''),'Explain your reasoning and give a practical example.'),v."referenceSources",v."rightsNotes",CASE WHEN v."importHash" IS NULL THEN 'MANUAL' ELSE 'IMPORT' END,
 v."createdById",v."reviewedById",v."reviewedAt",v."createdAt",v."updatedAt"
FROM bank_copy_map m JOIN "QuestionBankVersion" v ON v.id=m."copyId"
LEFT JOIN "QuestionEvaluatorSpec" s ON s."versionId"=v.id;
ALTER TABLE "QuestionImportRow" DROP CONSTRAINT "QuestionImportRow_resultVersionId_fkey";
UPDATE "QuestionImportRow" r SET "resultVersionId"=m."copyId"
FROM "QuestionBankVersion" v JOIN bank_copy_map m ON v."questionId"=m."itemId"
WHERE r."resultVersionId"=v.id;
ALTER TABLE "QuestionImportRow" RENAME COLUMN "resultVersionId" TO "resultQuestionId";
ALTER TABLE "QuestionImportRow" ADD CONSTRAINT "QuestionImportRow_resultQuestionId_fkey" FOREIGN KEY ("resultQuestionId") REFERENCES "QuestionBankQuestion"(id) ON DELETE SET NULL ON UPDATE CASCADE;
-- Pending previews use the old contract and must be inspected again.
UPDATE "QuestionImportRow" SET status='ERROR',errors=array_append(errors,'Import format changed; upload and preview this CSV again') WHERE status='READY';
UPDATE "QuestionImportBatch" SET status='SUPERSEDED' WHERE status IN ('PREVIEW','IMPORTING');
DROP TABLE "QuestionEvaluatorSpec";
ALTER TABLE "QuestionBankItem" DROP CONSTRAINT "QuestionBankItem_publishedVersionId_fkey";
DROP TABLE "QuestionBankVersion";
DROP TABLE "QuestionBankItem";
DROP FUNCTION bank_version_immutable();
DROP FUNCTION bank_rubric_immutable();
DROP FUNCTION bank_publication_integrity();
DROP TYPE "BankVersionStatus";
DROP TYPE "BankRightsBasis";
DROP TYPE "BankEvaluationMode";

-- CreateIndex
CREATE UNIQUE INDEX "QuestionBankQuestion_originKey_key" ON "public"."QuestionBankQuestion"("originKey");

-- CreateIndex
CREATE INDEX "QuestionBankQuestion_active_approved_track_difficulty_idx" ON "public"."QuestionBankQuestion"("active", "approved", "track", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionBankQuestion_namespace_externalQid_key" ON "public"."QuestionBankQuestion"("namespace", "externalQid");

-- CreateIndex
CREATE UNIQUE INDEX "BankFollowUpJob_key_key" ON "public"."BankFollowUpJob"("key");

-- CreateIndex
CREATE INDEX "BankFollowUpJob_status_nextAt_idx" ON "public"."BankFollowUpJob"("status", "nextAt");

-- AddForeignKey
ALTER TABLE "public"."QuestionBankQuestion" ADD CONSTRAINT "QuestionBankQuestion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuestionBankQuestion" ADD CONSTRAINT "QuestionBankQuestion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BankFollowUpJob" ADD CONSTRAINT "BankFollowUpJob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionBankQuestion" ADD CONSTRAINT bank_active_requires_approval CHECK (NOT active OR (approved AND "verbalSuitable"));
COMMIT;
