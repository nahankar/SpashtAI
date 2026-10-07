-- CreateEnum
CREATE TYPE "public"."BankVersionStatus" AS ENUM ('DRAFT', 'REVIEWED', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "public"."BankRightsBasis" AS ENUM ('UNRECORDED', 'OWNED', 'LICENSED', 'REWRITTEN');

-- CreateEnum
CREATE TYPE "public"."BankEvaluationMode" AS ENUM ('TECHNICAL', 'SCENARIO', 'BEHAVIORAL');

-- CreateTable
CREATE TABLE "public"."QuestionBankItem" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "externalQid" TEXT NOT NULL,
    "publishedVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionBankItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."QuestionBankVersion" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "public"."BankVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "questionText" TEXT NOT NULL,
    "track" TEXT,
    "category" TEXT,
    "topic" TEXT,
    "difficulty" TEXT,
    "experienceBand" TEXT,
    "frequency" TEXT,
    "questionType" TEXT,
    "roleArchetype" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trendNote" TEXT,
    "sourceFile" TEXT,
    "sourceSheet" TEXT,
    "importHash" TEXT,
    "sourceQuestionText" TEXT,
    "sourceAnswer" TEXT,
    "explanation" TEXT NOT NULL DEFAULT '',
    "exampleAnswer" TEXT NOT NULL DEFAULT '',
    "publicCriteria" JSONB NOT NULL DEFAULT '[]',
    "evaluationMode" "public"."BankEvaluationMode",
    "verbalSuitable" BOOLEAN NOT NULL DEFAULT false,
    "expectedDepth" TEXT NOT NULL DEFAULT '',
    "referenceSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rightsBasis" "public"."BankRightsBasis" NOT NULL DEFAULT 'UNRECORDED',
    "rightsNotes" TEXT NOT NULL DEFAULT '',
    "learnerContentRewritten" BOOLEAN NOT NULL DEFAULT false,
    "rubricIndependentlyAuthored" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionBankVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."QuestionEvaluatorSpec" (
    "versionId" TEXT NOT NULL,
    "rubric" JSONB NOT NULL,

    CONSTRAINT "QuestionEvaluatorSpec_pkey" PRIMARY KEY ("versionId")
);

-- CreateTable
CREATE TABLE "public"."QuestionImportBatch" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "importedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "QuestionImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."QuestionImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB NOT NULL,
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'READY',
    "outcome" TEXT,
    "resultVersionId" TEXT,

    CONSTRAINT "QuestionImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestionBankItem_publishedVersionId_key" ON "public"."QuestionBankItem"("publishedVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionBankItem_namespace_externalQid_key" ON "public"."QuestionBankItem"("namespace", "externalQid");

-- CreateIndex
CREATE INDEX "QuestionBankVersion_status_track_difficulty_idx" ON "public"."QuestionBankVersion"("status", "track", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionBankVersion_questionId_version_key" ON "public"."QuestionBankVersion"("questionId", "version");

-- One published version per question, even for writes outside the Admin API.
CREATE UNIQUE INDEX "QuestionBankVersion_one_published" ON "public"."QuestionBankVersion"("questionId") WHERE status = 'PUBLISHED';

-- CreateIndex
CREATE UNIQUE INDEX "QuestionImportBatch_fingerprint_key" ON "public"."QuestionImportBatch"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionImportRow_batchId_rowNumber_key" ON "public"."QuestionImportRow"("batchId", "rowNumber");

-- AddForeignKey
ALTER TABLE "public"."QuestionBankItem" ADD CONSTRAINT "QuestionBankItem_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "public"."QuestionBankVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuestionBankVersion" ADD CONSTRAINT "QuestionBankVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "public"."QuestionBankItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuestionBankVersion" ADD CONSTRAINT "QuestionBankVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuestionBankVersion" ADD CONSTRAINT "QuestionBankVersion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuestionBankVersion" ADD CONSTRAINT "QuestionBankVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuestionEvaluatorSpec" ADD CONSTRAINT "QuestionEvaluatorSpec_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "public"."QuestionBankVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuestionImportBatch" ADD CONSTRAINT "QuestionImportBatch_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuestionImportRow" ADD CONSTRAINT "QuestionImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "public"."QuestionImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."QuestionImportRow" ADD CONSTRAINT "QuestionImportRow_resultVersionId_fkey" FOREIGN KEY ("resultVersionId") REFERENCES "public"."QuestionBankVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Published content stays immutable, including after retirement. Actor FKs may
-- be nulled on account deletion; that does not delete shared authored content.
CREATE FUNCTION bank_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('PUBLISHED', 'RETIRED') THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Published bank versions cannot be deleted'; END IF;
    IF (to_jsonb(NEW) - ARRAY['status','retiredAt','updatedAt','createdById','reviewedById','publishedById'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','retiredAt','updatedAt','createdById','reviewedById','publishedById'])
       OR (NEW."createdById" IS DISTINCT FROM OLD."createdById" AND NEW."createdById" IS NOT NULL)
       OR (NEW."reviewedById" IS DISTINCT FROM OLD."reviewedById" AND NEW."reviewedById" IS NOT NULL)
       OR (NEW."publishedById" IS DISTINCT FROM OLD."publishedById" AND NEW."publishedById" IS NOT NULL)
       OR (OLD.status = 'PUBLISHED' AND NEW.status NOT IN ('PUBLISHED','RETIRED'))
       OR (OLD.status = 'RETIRED' AND NEW.status <> 'RETIRED') THEN
      RAISE EXCEPTION 'Published bank content is immutable; create a draft version';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER bank_version_immutable BEFORE UPDATE OR DELETE ON "QuestionBankVersion"
  FOR EACH ROW EXECUTE FUNCTION bank_version_immutable();

CREATE FUNCTION bank_rubric_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "QuestionBankVersion" WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."versionId" ELSE NEW."versionId" END AND status IN ('PUBLISHED','RETIRED'))
     OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM "QuestionBankVersion" WHERE id = OLD."versionId" AND status IN ('PUBLISHED','RETIRED'))) THEN
    RAISE EXCEPTION 'Published evaluator material is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER bank_rubric_immutable BEFORE INSERT OR UPDATE OR DELETE ON "QuestionEvaluatorSpec"
  FOR EACH ROW EXECUTE FUNCTION bank_rubric_immutable();

-- Publication pointer must belong to this question and refer to a published
-- version. Deferred checks let retirement and replacement be atomic.
CREATE FUNCTION bank_publication_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected_id text;
BEGIN
  IF TG_TABLE_NAME = 'QuestionBankItem' THEN affected_id := NEW.id; ELSE affected_id := NEW."questionId"; END IF;
  IF EXISTS (SELECT 1 FROM "QuestionBankItem" i JOIN "QuestionBankVersion" v ON v.id = i."publishedVersionId"
    WHERE i.id = affected_id
      AND (v."questionId" <> i.id OR v.status <> 'PUBLISHED')) THEN
    RAISE EXCEPTION 'Invalid bank publication pointer';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bank_item_publication_integrity AFTER INSERT OR UPDATE ON "QuestionBankItem"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bank_publication_integrity();
CREATE CONSTRAINT TRIGGER bank_version_publication_integrity AFTER INSERT OR UPDATE ON "QuestionBankVersion"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bank_publication_integrity();

ALTER TABLE "QuestionBankVersion" ADD CONSTRAINT bank_published_review_and_rights CHECK (status NOT IN ('PUBLISHED','RETIRED') OR ("rightsBasis" <> 'UNRECORDED' AND length(trim("rightsNotes")) >= 10 AND "reviewedAt" IS NOT NULL AND "publishedAt" IS NOT NULL));
