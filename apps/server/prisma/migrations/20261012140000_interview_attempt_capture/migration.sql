-- CreateTable
CREATE TABLE "public"."InterviewRun" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "namespace" TEXT NOT NULL DEFAULT 'automation-pilot',
    "track" TEXT NOT NULL,
    "experienceBand" TEXT NOT NULL,
    "startingDifficulty" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 10,
    "maxQuestions" INTEGER NOT NULL DEFAULT 8,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InterviewAttempt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'BANK',
    "questionId" TEXT,
    "parentAttemptId" TEXT,
    "questionSnapshot" JSONB NOT NULL,
    "questionHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "assistance" TEXT NOT NULL DEFAULT 'NONE',
    "askedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InterviewAnswerChunk" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "sourceTurnId" TEXT NOT NULL,
    "localTurnIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewAnswerChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterviewRun_sessionId_key" ON "public"."InterviewRun"("sessionId");

-- CreateIndex
CREATE INDEX "InterviewRun_ownerId_createdAt_idx" ON "public"."InterviewRun"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "InterviewAttempt_runId_status_idx" ON "public"."InterviewAttempt"("runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewAttempt_runId_index_key" ON "public"."InterviewAttempt"("runId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewAttempt_runId_questionId_key" ON "public"."InterviewAttempt"("runId", "questionId");

-- CreateIndex
CREATE INDEX "InterviewAnswerChunk_attemptId_idx" ON "public"."InterviewAnswerChunk"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewAnswerChunk_segmentId_sourceTurnId_key" ON "public"."InterviewAnswerChunk"("segmentId", "sourceTurnId");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewAnswerChunk_segmentId_localTurnIndex_key" ON "public"."InterviewAnswerChunk"("segmentId", "localTurnIndex");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewAnswerSnapshot_attemptId_textRevision_key" ON "public"."InterviewAnswerSnapshot"("attemptId", "textRevision");

-- AddForeignKey
ALTER TABLE "public"."InterviewRun" ADD CONSTRAINT "InterviewRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewRun" ADD CONSTRAINT "InterviewRun_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewAttempt" ADD CONSTRAINT "InterviewAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."InterviewRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewAttempt" ADD CONSTRAINT "InterviewAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "public"."QuestionBankQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewAttempt" ADD CONSTRAINT "InterviewAttempt_parentAttemptId_fkey" FOREIGN KEY ("parentAttemptId") REFERENCES "public"."InterviewAttempt"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewAnswerChunk" ADD CONSTRAINT "InterviewAnswerChunk_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "public"."InterviewAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewAnswerChunk" ADD CONSTRAINT "InterviewAnswerChunk_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "public"."SessionSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InterviewAnswerSnapshot" ADD CONSTRAINT "InterviewAnswerSnapshot_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "public"."InterviewAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Capture is a separate source contract. Recording-based assessments remain reserved.
ALTER TABLE "InterviewAnswerSnapshot" DROP CONSTRAINT "InterviewAnswerSnapshot_admin_source";
ALTER TABLE "InterviewAnswerSnapshot" ADD CONSTRAINT "InterviewAnswerSnapshot_source_contract"
CHECK ("recordingId" IS NULL AND "textRevision" = 1 AND language = 'en'
  AND assistance IN ('NONE','HINT','EXAMPLE') AND (
    (source = 'ADMIN_TEST' AND "attemptId" IS NULL AND "textSource" = 'ADMIN_TYPED') OR
    (source = 'LIVE_ATTEMPT' AND "attemptId" IS NOT NULL AND "textSource" = 'AGENT_COMMITTED_TURNS')
  ));
ALTER TABLE "InterviewRun" ADD CONSTRAINT "InterviewRun_setup"
CHECK (namespace = 'automation-pilot' AND length(trim(track)) BETWEEN 1 AND 120
  AND length(trim("experienceBand")) BETWEEN 1 AND 40 AND "durationMinutes" IN (5,10,15)
  AND "maxQuestions" = 8 AND "startingDifficulty" IN ('Simple','Medium','Complex','Very Complex'));
ALTER TABLE "InterviewAttempt" ADD CONSTRAINT "InterviewAttempt_state"
CHECK ("index" BETWEEN 1 AND 8 AND origin = 'BANK' AND "parentAttemptId" IS NULL
  AND status IN ('PREPARED','ASKED','ANSWERED','SKIPPED') AND assistance IN ('NONE','HINT','EXAMPLE')
  AND ((status = 'PREPARED') = ("askedAt" IS NULL))
  AND ((status IN ('ANSWERED','SKIPPED')) = ("completedAt" IS NOT NULL)));
CREATE UNIQUE INDEX "InterviewAttempt_one_open" ON "InterviewAttempt"("runId") WHERE status IN ('PREPARED','ASKED');
ALTER TABLE "InterviewAnswerChunk" ADD CONSTRAINT "InterviewAnswerChunk_content"
CHECK ("localTurnIndex" >= 0 AND length(trim(text)) BETWEEN 1 AND 8000);

CREATE FUNCTION enforce_interview_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Interview run configuration is immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Session" s WHERE s.id = NEW."sessionId" AND s."userId" = NEW."ownerId"
    AND s.purpose = 'INTERVIEW' AND s."contextScope" = 'SESSION_ONLY' AND s.module = 'elevate'
    AND s."discardedAt" IS NULL AND s."endedAt" IS NULL) THEN
    RAISE EXCEPTION 'Interview run must own a writable standalone interview session';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InterviewRun_owner" BEFORE INSERT OR UPDATE ON "InterviewRun" FOR EACH ROW EXECUTE FUNCTION enforce_interview_run();
CREATE FUNCTION preserve_interview_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "InterviewRun" r WHERE r."sessionId" = OLD.id) AND
    (NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW.purpose <> 'INTERVIEW'
      OR NEW."contextScope" <> 'SESSION_ONLY' OR NEW.module <> 'elevate') THEN
    RAISE EXCEPTION 'Interview session ownership and purpose cannot change';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Session_interview_run_policy" BEFORE UPDATE ON "Session" FOR EACH ROW EXECUTE FUNCTION preserve_interview_session();
CREATE FUNCTION preserve_interview_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['questionId','status','assistance','askedAt','completedAt']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['questionId','status','assistance','askedAt','completedAt'])
    OR (NEW."questionId" IS DISTINCT FROM OLD."questionId" AND NEW."questionId" IS NOT NULL)
    OR (NEW.status <> OLD.status AND NOT ((OLD.status='PREPARED' AND NEW.status='ASKED')
      OR (OLD.status='ASKED' AND NEW.status IN ('ANSWERED','SKIPPED'))))
    OR (OLD."askedAt" IS NOT NULL AND NEW."askedAt" IS DISTINCT FROM OLD."askedAt")
    OR (OLD."completedAt" IS NOT NULL AND NEW."completedAt" IS DISTINCT FROM OLD."completedAt")
    OR (OLD.status IN ('ANSWERED','SKIPPED') AND NEW.assistance <> OLD.assistance)
    OR (OLD.assistance='EXAMPLE' AND NEW.assistance <> 'EXAMPLE')
    OR (OLD.assistance='HINT' AND NEW.assistance='NONE') THEN
    RAISE EXCEPTION 'Interview question and committed attempt are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InterviewAttempt_immutable" BEFORE UPDATE ON "InterviewAttempt" FOR EACH ROW EXECUTE FUNCTION preserve_interview_attempt();
CREATE FUNCTION enforce_interview_chunk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Committed speech chunks are immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "InterviewAttempt" a JOIN "InterviewRun" r ON r.id=a."runId"
    JOIN "Session" s ON s.id=r."sessionId" JOIN "SessionSegment" g ON g."sessionId"=s.id
    WHERE a.id=NEW."attemptId" AND a.status='ASKED' AND g.id=NEW."segmentId"
      AND g."endedAt" IS NULL AND s."endedAt" IS NULL AND s."discardedAt" IS NULL) THEN
    RAISE EXCEPTION 'Speech chunk must belong to the open attempt and active owned segment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InterviewAnswerChunk_owner" BEFORE INSERT OR UPDATE ON "InterviewAnswerChunk" FOR EACH ROW EXECUTE FUNCTION enforce_interview_chunk();
CREATE FUNCTION enforce_live_interview_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a RECORD; committed TEXT;
BEGIN
  IF NEW.source <> 'LIVE_ATTEMPT' THEN RETURN NEW; END IF;
  SELECT t.*, r."ownerId", s."discardedAt" INTO a FROM "InterviewAttempt" t
    JOIN "InterviewRun" r ON r.id=t."runId" JOIN "Session" s ON s.id=r."sessionId"
    WHERE t.id=NEW."attemptId";
  IF NOT FOUND OR a."ownerId" <> NEW."ownerId" OR a.status <> 'ANSWERED' OR a."discardedAt" IS NOT NULL
    OR a."questionHash" <> NEW."questionHash" OR a."questionSnapshot" <> NEW."questionSnapshot"
    OR a."questionId" IS DISTINCT FROM NEW."questionId" OR a.assistance <> NEW.assistance THEN
    RAISE EXCEPTION 'Live snapshot must capture its owned completed attempt';
  END IF;
  SELECT string_agg(c.text, E'\n' ORDER BY g."segmentIndex", c."localTurnIndex") INTO committed
    FROM "InterviewAnswerChunk" c JOIN "SessionSegment" g ON g.id=c."segmentId" WHERE c."attemptId"=NEW."attemptId";
  IF committed IS NULL OR committed <> NEW."answerText" OR length(committed)>8000 THEN
    RAISE EXCEPTION 'Live snapshot must preserve the exact committed speech';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "InterviewAnswerSnapshot_live_owner" BEFORE INSERT ON "InterviewAnswerSnapshot" FOR EACH ROW EXECUTE FUNCTION enforce_live_interview_snapshot();
