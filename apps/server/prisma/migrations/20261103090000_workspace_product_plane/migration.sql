-- Stage 3: workspace ownership for every learner product root, inherited child
-- isolation, cross-root consistency and aggregate-only manager reads.
-- Existing rows stay Personal. No organization row is created by this migration.

-- Shared Personal bridge (identical semantics to the Session trigger).
CREATE FUNCTION public.ensure_personal_workspace(p_user text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE found text;
BEGIN
  INSERT INTO public."Workspace" (id,kind,slug,name,"personalOwnerId","isolationStage","maxMembers","updatedAt")
  VALUES ('personal_'||p_user,'PERSONAL','personal-'||lower(p_user),'Personal',p_user,'PERSONAL_LEGACY',1,CURRENT_TIMESTAMP)
  ON CONFLICT ("personalOwnerId") DO NOTHING;
  SELECT id INTO found FROM public."Workspace" WHERE "personalOwnerId"=p_user;
  INSERT INTO public."WorkspaceMember" (id,"workspaceId","userId",role,state,"acceptedAt","updatedAt")
  VALUES ('personal_member_'||p_user,found,p_user,'OWNER','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  ON CONFLICT ("workspaceId","userId") DO NOTHING;
  RETURN found;
END $$;
REVOKE ALL ON FUNCTION public.ensure_personal_workspace(text) FROM PUBLIC;

-- Owner/Admin aggregate reads in their own organization. The reader setting alone
-- grants nothing: the current role and state are rechecked for every row.
CREATE FUNCTION public.workspace_manager_reads(p_workspace text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT coalesce(current_setting('app.workspace_reader',true),'')='manager'
 AND p_workspace=current_setting('app.workspace_id',true)
 AND EXISTS (SELECT 1 FROM public."Workspace" w JOIN public."WorkspaceMember" m ON m."workspaceId"=w.id
   WHERE w.id=p_workspace AND w.kind='ORGANIZATION' AND w.state='ACTIVE'
   AND m."userId"=current_setting('app.workspace_actor_id',true) AND m.state='ACTIVE' AND m.role IN ('OWNER','ADMIN'));
$$;

-- Tombstoned activity may be destroyed by the cleanup job after membership ends.
CREATE FUNCTION public.workspace_cleanup_reads(p_workspace text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT coalesce(current_setting('app.workspace_reader',true),'')='cleanup'
 AND p_workspace=current_setting('app.workspace_id',true)
 AND EXISTS (SELECT 1 FROM public."Workspace" w WHERE w.id=p_workspace AND w.kind='ORGANIZATION');
$$;

-- Session: infer the verified request/job workspace instead of refusing context.
CREATE OR REPLACE FUNCTION public.assign_session_workspace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE parent public."Workspace"%ROWTYPE; ctx text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" OR NEW."workspaceKind" IS DISTINCT FROM OLD."workspaceKind"
      OR NEW."userId" IS DISTINCT FROM OLD."userId" THEN
      RAISE EXCEPTION 'Session workspace ownership is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  ctx := nullif(current_setting('app.workspace_id',true),'');
  IF coalesce(NEW."workspaceId",'')='' THEN
    NEW."workspaceId" := coalesce(ctx, public.ensure_personal_workspace(NEW."userId"));
  ELSIF ctx IS NOT NULL AND NEW."workspaceId" <> ctx THEN
    RAISE EXCEPTION 'Session workspace does not match the verified workspace' USING ERRCODE='42501';
  END IF;
  SELECT * INTO parent FROM public."Workspace" WHERE id=NEW."workspaceId";
  IF parent.id IS NULL THEN RAISE EXCEPTION 'Unknown session workspace' USING ERRCODE='23503'; END IF;
  NEW."workspaceKind" := parent.kind;
  IF parent.kind='PERSONAL' AND parent."personalOwnerId" <> NEW."userId" THEN
    RAISE EXCEPTION 'Personal session ownership mismatch' USING ERRCODE='23514';
  END IF;
  IF parent.kind='ORGANIZATION' AND (parent.state <> 'ACTIVE' OR NOT EXISTS (
    SELECT 1 FROM public."WorkspaceMember" m WHERE m."workspaceId"=parent.id AND m."userId"=NEW."userId" AND m.state='ACTIVE')) THEN
    RAISE EXCEPTION 'Session learner must be an active workspace member' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Generic root ownership: TG_ARGV[0] names the learner column.
CREATE FUNCTION public.assign_owned_workspace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE parent public."Workspace"%ROWTYPE; owner_id text; ctx text; target text;
BEGIN
  owner_id := to_jsonb(NEW)->>TG_ARGV[0];
  IF TG_OP='UPDATE' THEN
    IF NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" OR NEW."workspaceKind" IS DISTINCT FROM OLD."workspaceKind"
      OR owner_id IS DISTINCT FROM to_jsonb(OLD)->>TG_ARGV[0] THEN
      RAISE EXCEPTION '% workspace ownership is immutable', TG_TABLE_NAME USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  ctx := nullif(current_setting('app.workspace_id',true),'');
  target := nullif(NEW."workspaceId",'');
  IF target IS NULL THEN
    target := coalesce(ctx, public.ensure_personal_workspace(owner_id));
  ELSIF ctx IS NOT NULL AND target <> ctx THEN
    RAISE EXCEPTION '% workspace does not match the verified workspace', TG_TABLE_NAME USING ERRCODE='42501';
  END IF;
  SELECT * INTO parent FROM public."Workspace" WHERE id=target;
  IF parent.id IS NULL THEN RAISE EXCEPTION 'Unknown % workspace', TG_TABLE_NAME USING ERRCODE='23503'; END IF;
  IF parent.kind='PERSONAL' AND parent."personalOwnerId" IS DISTINCT FROM owner_id THEN
    RAISE EXCEPTION '% Personal ownership mismatch', TG_TABLE_NAME USING ERRCODE='23514';
  END IF;
  IF parent.kind='ORGANIZATION' AND (parent.state <> 'ACTIVE' OR NOT EXISTS (
    SELECT 1 FROM public."WorkspaceMember" m WHERE m."workspaceId"=parent.id AND m."userId"=owner_id AND m.state='ACTIVE')) THEN
    RAISE EXCEPTION '% learner must be an active workspace member', TG_TABLE_NAME USING ERRCODE='23514';
  END IF;
  NEW."workspaceId" := parent.id;
  NEW."workspaceKind" := parent.kind;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.assign_owned_workspace() FROM PUBLIC;

-- Add ownership columns, backfill to Personal, constrain and protect.
DO $$ DECLARE spec text[]; tbl text; owner text; BEGIN
 FOREACH spec SLICE 1 IN ARRAY ARRAY[
   ARRAY['ReplaySession','userId'], ARRAY['Preparation','userId'], ARRAY['ProgressPulse','userId'],
   ARRAY['FeatureUsage','userId'], ARRAY['CoachThread','userId'], ARRAY['CoachHomeResultReceipt','userId'],
   ARRAY['UserFeedback','userId'], ARRAY['RecordingAcknowledgment','userId']] LOOP
  tbl := spec[1]; owner := spec[2];
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN "workspaceId" text NOT NULL DEFAULT %L, ADD COLUMN "workspaceKind" public."WorkspaceKind" NOT NULL DEFAULT %L', tbl, '', 'PERSONAL');
  EXECUTE format('UPDATE public.%I t SET "workspaceId"=public.ensure_personal_workspace(t.%I), "workspaceKind"=%L', tbl, owner, 'PERSONAL');
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY ("workspaceId","workspaceKind") REFERENCES public."Workspace"(id,kind) ON DELETE CASCADE ON UPDATE NO ACTION', tbl, tbl||'_workspaceId_workspaceKind_fkey');
  EXECUTE format('CREATE TRIGGER workspace_owner_identity BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.assign_owned_workspace(%L)', tbl, owner);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('CREATE POLICY workspace_owner_boundary ON public.%I FOR ALL USING (public.session_workspace_permits("workspaceId","workspaceKind",%I)) WITH CHECK (public.session_workspace_permits("workspaceId","workspaceKind",%I))', tbl, owner, owner);
 END LOOP;
END $$;

CREATE INDEX "ReplaySession_workspaceId_userId_createdAt_idx" ON "ReplaySession"("workspaceId","userId","createdAt");
CREATE INDEX "Preparation_workspaceId_userId_idx" ON "Preparation"("workspaceId","userId");
CREATE INDEX "ProgressPulse_workspaceId_recordedAt_idx" ON "ProgressPulse"("workspaceId","recordedAt");
CREATE INDEX "FeatureUsage_workspaceId_timestamp_idx" ON "FeatureUsage"("workspaceId","timestamp");
CREATE INDEX "FeatureUsage_workspaceId_feature_timestamp_idx" ON "FeatureUsage"("workspaceId","feature","timestamp");
CREATE INDEX "CoachThread_workspaceId_userId_idx" ON "CoachThread"("workspaceId","userId");
CREATE INDEX "UserFeedback_workspaceId_createdAt_idx" ON "UserFeedback"("workspaceId","createdAt");
-- Organization practices need their own acknowledgment; Personal acceptance never carries over.
ALTER TABLE "RecordingAcknowledgment" DROP CONSTRAINT IF EXISTS "RecordingAcknowledgment_userId_version_key";
DROP INDEX IF EXISTS "RecordingAcknowledgment_userId_version_key";
CREATE UNIQUE INDEX "RecordingAcknowledgment_workspaceId_userId_version_key" ON "RecordingAcknowledgment"("workspaceId","userId","version");

-- Aggregate reads for Owner/Admin reports. Raw transcripts, recordings, uploads,
-- results and answers stay learner-only because their tables have no such policy.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['Session','ReplaySession','ProgressPulse','FeatureUsage','UserFeedback'] LOOP
  EXECUTE format('CREATE POLICY workspace_manager_aggregate_read ON public.%I FOR SELECT USING (public.workspace_manager_reads("workspaceId"))', tbl);
 END LOOP;
END $$;
-- Platform staff handle all product feedback through the audited platform context.
CREATE POLICY platform_feedback_read ON "UserFeedback" FOR SELECT USING (
  coalesce(current_setting('app.workspace_platform_admin',true),'')='true');
CREATE POLICY platform_feedback_update ON "UserFeedback" FOR UPDATE USING (
  coalesce(current_setting('app.workspace_platform_admin',true),'')='true')
  WITH CHECK (coalesce(current_setting('app.workspace_platform_admin',true),'')='true');
CREATE POLICY session_cleanup_boundary ON "Session" FOR ALL USING (
  "discardedAt" IS NOT NULL AND public.workspace_cleanup_reads("workspaceId"));
-- Cleanup removes only Pulse evidence of a discarded voice session in the same workspace
-- (DELETE with a filter also requires the rows to be selectable).
CREATE FUNCTION public.workspace_pulse_cleanup(p_workspace text, p_source text, p_session text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT public.workspace_cleanup_reads(p_workspace) AND p_source='elevate' AND EXISTS (
    SELECT 1 FROM public."Session" s WHERE s.id=p_session AND s."workspaceId"=p_workspace AND s."discardedAt" IS NOT NULL) $$;
CREATE POLICY pulse_cleanup_read ON "ProgressPulse" FOR SELECT USING (public.workspace_pulse_cleanup("workspaceId", source, "sessionId"));
CREATE POLICY pulse_cleanup_delete ON "ProgressPulse" FOR DELETE USING (public.workspace_pulse_cleanup("workspaceId", source, "sessionId"));

-- Children inherit visibility through their unique parent. Manager aggregate reads expose
-- parents only, so raw child content (transcripts, turns, recordings, answers) is never
-- visible in manager reader mode.
CREATE OR REPLACE FUNCTION public.workspace_raw_reads() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.workspace_reader',true),'') <> 'manager' $$;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['SessionMetrics','SessionRecording','SessionSegment','SessionTranscript','SessionTurn'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS session_parent_boundary ON public.%I', tbl);
  EXECUTE format('CREATE POLICY session_parent_boundary ON public.%I FOR ALL USING (public.workspace_raw_reads() AND EXISTS (SELECT 1 FROM public."Session" s WHERE s.id="sessionId")) WITH CHECK (public.workspace_raw_reads() AND EXISTS (SELECT 1 FROM public."Session" s WHERE s.id="sessionId"))', tbl);
 END LOOP;
END $$;
DO $$ DECLARE spec text[]; BEGIN
 FOREACH spec SLICE 1 IN ARRAY ARRAY[
   ARRAY['ReplayUpload','ReplaySession','replaySessionId'], ARRAY['ReplayResult','ReplaySession','replaySessionId'],
   ARRAY['InterviewPreparation','Preparation','preparationId'], ARRAY['PreparationStage','Preparation','preparationId'],
   ARRAY['InterviewQuestion','Preparation','preparationId'], ARRAY['StageReflection','Preparation','preparationId'],
   ARRAY['PreparationPractice','Preparation','preparationId'], ARRAY['PreparationRecording','Preparation','preparationId'],
   ARRAY['CoachTurn','CoachThread','threadId'], ARRAY['CoachAction','CoachThread','threadId'],
   ARRAY['UserFeedbackAttachment','UserFeedback','feedbackId'], ARRAY['UserFeedbackNote','UserFeedback','feedbackId'],
   ARRAY['InterviewRun','Session','sessionId'], ARRAY['InterviewAttempt','InterviewRun','runId'],
   ARRAY['InterviewCaptureReceipt','InterviewAttempt','attemptId'], ARRAY['InterviewAnswerChunk','InterviewAttempt','attemptId'],
   ARRAY['InterviewTranscriptIssue','InterviewAttempt','attemptId'], ARRAY['InterviewAssessment','InterviewAnswerSnapshot','snapshotId'],
   ARRAY['BankFollowUpJob','Session','sessionId']] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', spec[1]);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', spec[1]);
  EXECUTE format('CREATE POLICY workspace_parent_boundary ON public.%I FOR ALL USING (public.workspace_raw_reads() AND EXISTS (SELECT 1 FROM public.%I p WHERE p.id=%I)) WITH CHECK (public.workspace_raw_reads() AND EXISTS (SELECT 1 FROM public.%I p WHERE p.id=%I))',
    spec[1], spec[2], spec[3], spec[2], spec[3]);
 END LOOP;
END $$;
-- Platform evaluator tests have no attempt and are never visible inside an organization.
ALTER TABLE "InterviewAnswerSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InterviewAnswerSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_parent_boundary ON "InterviewAnswerSnapshot" FOR ALL
USING (public.workspace_raw_reads() AND CASE WHEN "attemptId" IS NULL THEN nullif(current_setting('app.workspace_id',true),'') IS NULL
  ELSE EXISTS (SELECT 1 FROM public."InterviewAttempt" a WHERE a.id="attemptId") END)
WITH CHECK (public.workspace_raw_reads() AND CASE WHEN "attemptId" IS NULL THEN nullif(current_setting('app.workspace_id',true),'') IS NULL
  ELSE EXISTS (SELECT 1 FROM public."InterviewAttempt" a WHERE a.id="attemptId") END);

-- Content-free evaluator accounting carries its own optional organization scope.
ALTER TABLE "InterviewEvaluatorUsage" ADD COLUMN "workspaceId" text;
ALTER TABLE "InterviewEvaluatorUsage" ADD CONSTRAINT "InterviewEvaluatorUsage_workspaceId_fkey"
 FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id) ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "InterviewEvaluatorUsage_workspaceId_createdAt_idx" ON "InterviewEvaluatorUsage"("workspaceId","createdAt");
ALTER TABLE "InterviewEvaluatorUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InterviewEvaluatorUsage" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_usage_boundary ON "InterviewEvaluatorUsage" FOR ALL
USING (CASE WHEN "workspaceId" IS NULL THEN nullif(current_setting('app.workspace_id',true),'') IS NULL
  ELSE "workspaceId"=current_setting('app.workspace_id',true) END)
WITH CHECK (CASE WHEN "workspaceId" IS NULL THEN nullif(current_setting('app.workspace_id',true),'') IS NULL
  ELSE "workspaceId"=current_setting('app.workspace_id',true) END);

-- The storage outbox survives its parent; attribution is retained for audits.
ALTER TABLE "ReplayDeletion" ADD COLUMN "workspaceId" text;

-- Cross-root links must stay within one workspace and learner, and cannot move.
DROP TRIGGER IF EXISTS reject_unscoped_org_session ON "PreparationPractice";
DROP TRIGGER IF EXISTS reject_unscoped_org_session ON "InterviewRun";
DROP TRIGGER IF EXISTS reject_unscoped_org_session ON "ProgressPulse";
DROP TRIGGER IF EXISTS reject_unscoped_org_session ON "CoachAction";

CREATE FUNCTION public.protect_workspace_links() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE a_ws text; a_user text; b_ws text; b_user text; link text;
BEGIN
 IF TG_OP='UPDATE' THEN
  FOREACH link IN ARRAY TG_ARGV LOOP
   IF to_jsonb(NEW)->>link IS DISTINCT FROM to_jsonb(OLD)->>link AND link NOT IN ('stageId','segmentId','questionId') THEN
    RAISE EXCEPTION '% parent ownership is immutable', TG_TABLE_NAME USING ERRCODE='23514';
   END IF;
  END LOOP;
 END IF;
 IF TG_TABLE_NAME='PreparationPractice' THEN
  SELECT "workspaceId","userId" INTO a_ws,a_user FROM public."Preparation" WHERE id=NEW."preparationId";
  SELECT "workspaceId","userId" INTO b_ws,b_user FROM public."Session" WHERE id=NEW."sessionId";
 ELSIF TG_TABLE_NAME='PreparationRecording' THEN
  SELECT "workspaceId","userId" INTO a_ws,a_user FROM public."Preparation" WHERE id=NEW."preparationId";
  SELECT "workspaceId","userId" INTO b_ws,b_user FROM public."ReplaySession" WHERE id=NEW."replaySessionId";
 ELSIF TG_TABLE_NAME IN ('PreparationStage','InterviewQuestion','StageReflection','InterviewPreparation') THEN
  IF to_jsonb(NEW)->>'stageId' IS NOT NULL AND TG_TABLE_NAME <> 'PreparationStage' AND NOT EXISTS (
    SELECT 1 FROM public."PreparationStage" s WHERE s.id=to_jsonb(NEW)->>'stageId' AND s."preparationId"=NEW."preparationId") THEN
   RAISE EXCEPTION 'Stage belongs to another journey' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 ELSIF TG_TABLE_NAME='ProgressPulse' THEN
  IF NEW."sessionId" IS NULL THEN RETURN NEW; END IF;
  a_ws := NEW."workspaceId"; a_user := NEW."userId";
  IF NEW.source='replay' THEN
   SELECT "workspaceId","userId" INTO b_ws,b_user FROM public."ReplaySession" WHERE id=NEW."sessionId";
  ELSE
   SELECT "workspaceId","userId" INTO b_ws,b_user FROM public."Session" WHERE id=NEW."sessionId";
  END IF;
  IF b_ws IS NULL THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='CoachThread' THEN
  IF NEW."preparationId" IS NULL THEN RETURN NEW; END IF;
  a_ws := NEW."workspaceId"; a_user := NEW."userId";
  SELECT "workspaceId","userId" INTO b_ws,b_user FROM public."Preparation" WHERE id=NEW."preparationId";
 ELSIF TG_TABLE_NAME='CoachAction' THEN
  SELECT "workspaceId","userId" INTO a_ws,a_user FROM public."CoachThread" WHERE id=NEW."threadId";
  IF NEW."targetId" IS NULL THEN RETURN NEW; END IF;
  IF NEW.module='elevate' THEN SELECT "workspaceId","userId" INTO b_ws,b_user FROM public."Session" WHERE id=NEW."targetId";
  ELSIF NEW.module='replay' THEN SELECT "workspaceId","userId" INTO b_ws,b_user FROM public."ReplaySession" WHERE id=NEW."targetId";
  ELSIF NEW.module='prepare' THEN SELECT "workspaceId","userId" INTO b_ws,b_user FROM public."Preparation" WHERE id=NEW."targetId";
  ELSE RETURN NEW; END IF;
  IF b_ws IS NULL THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='InterviewRun' THEN
  SELECT "workspaceId","userId" INTO a_ws,a_user FROM public."Session" WHERE id=NEW."sessionId";
  b_ws := a_ws; b_user := NEW."ownerId";
 ELSIF TG_TABLE_NAME='InterviewAttempt' THEN
  IF NEW."parentAttemptId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public."InterviewAttempt" p WHERE p.id=NEW."parentAttemptId" AND p."runId"=NEW."runId") THEN
   RAISE EXCEPTION 'Follow-up belongs to another interview run' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 ELSIF TG_TABLE_NAME IN ('InterviewCaptureReceipt','InterviewAnswerChunk','InterviewTranscriptIssue') THEN
  IF NOT EXISTS (SELECT 1 FROM public."InterviewAttempt" a JOIN public."InterviewRun" r ON r.id=a."runId"
    JOIN public."SessionSegment" g ON g."sessionId"=r."sessionId" WHERE a.id=NEW."attemptId" AND g.id=NEW."segmentId") THEN
   RAISE EXCEPTION 'Answer segment belongs to another interview session' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 ELSIF TG_TABLE_NAME='InterviewAnswerSnapshot' THEN
  IF NEW."attemptId" IS NULL THEN RETURN NEW; END IF;
  SELECT r."ownerId" INTO a_user FROM public."InterviewAttempt" a JOIN public."InterviewRun" r ON r.id=a."runId" WHERE a.id=NEW."attemptId";
  IF a_user IS DISTINCT FROM NEW."ownerId" THEN
   RAISE EXCEPTION 'Answer owner does not match the interview run' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 ELSE
  RETURN NEW;
 END IF;
 IF a_ws IS DISTINCT FROM b_ws OR a_user IS DISTINCT FROM b_user THEN
  RAISE EXCEPTION '% links records from different workspaces or learners', TG_TABLE_NAME USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_workspace_links() FROM PUBLIC;

CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "PreparationPractice" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('preparationId','sessionId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "PreparationRecording" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('preparationId','replaySessionId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "PreparationStage" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('preparationId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "InterviewQuestion" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('preparationId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "StageReflection" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('preparationId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "InterviewPreparation" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('preparationId');
-- ProgressPulse/CoachThread run after the ownership trigger (alphabetical trigger order).
CREATE TRIGGER workspace_xlink_identity BEFORE INSERT OR UPDATE ON "ProgressPulse" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('sessionId');
CREATE TRIGGER workspace_xlink_identity BEFORE INSERT OR UPDATE ON "CoachThread" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links();
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "CoachAction" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('threadId','targetId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "CoachTurn" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('threadId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "InterviewRun" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('sessionId','ownerId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "InterviewAttempt" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('runId','parentAttemptId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "InterviewCaptureReceipt" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('attemptId','segmentId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "InterviewAnswerChunk" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('attemptId','segmentId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "InterviewTranscriptIssue" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('attemptId','segmentId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "InterviewAnswerSnapshot" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('attemptId','ownerId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "InterviewAssessment" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('snapshotId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "ReplayUpload" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('replaySessionId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "ReplayResult" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('replaySessionId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "UserFeedbackAttachment" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('feedbackId');
CREATE TRIGGER workspace_link_identity BEFORE INSERT OR UPDATE ON "UserFeedbackNote" FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_links('feedbackId');

-- Content-free job discovery: identifiers of organization learners with due work.
-- Each job then re-establishes its own verified, transaction-local scope.
CREATE FUNCTION public.workspace_job_scopes(p_job text) RETURNS TABLE("workspaceId" text, "userId" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT DISTINCT s."workspaceId", s."userId" FROM public."Session" s
 JOIN public."Workspace" w ON w.id=s."workspaceId" AND w.kind='ORGANIZATION'
 WHERE s."workspaceKind"='ORGANIZATION' AND CASE p_job
  WHEN 'session_deletion' THEN s."discardedAt" IS NOT NULL
  WHEN 'pace_reconciliation' THEN s."discardedAt" IS NULL AND s."paceReconciliationStatus" IN ('pending','processing','retry','waiting_for_evidence')
  WHEN 'delivery_alignment' THEN s."discardedAt" IS NULL AND s."endedAt" IS NOT NULL AND s."deliveryAlignmentStatus" IN ('pending','processing','retry')
  WHEN 'session_inactivity' THEN s."discardedAt" IS NULL AND s."endedAt" IS NULL AND s."startedAt" < CURRENT_TIMESTAMP - interval '23 hours'
  WHEN 'audio_enrichment' THEN s."discardedAt" IS NULL AND EXISTS (SELECT 1 FROM public."SessionMetrics" m WHERE m."sessionId"=s.id
    AND m."processingStatus"->>'audioEnrichmentStatus' IN ('retry','processing'))
  WHEN 'learner_evaluation' THEN s."discardedAt" IS NULL AND EXISTS (SELECT 1 FROM public."InterviewRun" r
    JOIN public."InterviewAttempt" a ON a."runId"=r.id JOIN public."InterviewAnswerSnapshot" n ON n."attemptId"=a.id
    JOIN public."InterviewAssessment" x ON x."snapshotId"=n.id WHERE r."sessionId"=s.id AND x.status IN ('PENDING','RUNNING'))
  ELSE false END
 AND (p_job='session_deletion' OR (w.state='ACTIVE' AND EXISTS (SELECT 1 FROM public."WorkspaceMember" m
   WHERE m."workspaceId"=w.id AND m."userId"=s."userId" AND m.state='ACTIVE')))
 -- Discovery is for the unscoped worker sweep only; an organization request or job sees nothing.
 AND nullif(current_setting('app.workspace_id',true),'') IS NULL
 LIMIT 200;
$$;

-- Live voice concurrency: open, recently active segments in one organization.
CREATE FUNCTION public.workspace_open_voice_segments(p_workspace text) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT CASE WHEN p_workspace=current_setting('app.workspace_id',true) THEN (
  SELECT count(*) FROM public."SessionSegment" g JOIN public."Session" s ON s.id=g."sessionId"
  WHERE s."workspaceId"=p_workspace AND s."endedAt" IS NULL AND s."discardedAt" IS NULL AND g."endedAt" IS NULL
  AND g."interviewDrainedAt" IS NULL AND g."updatedAt" > CURRENT_TIMESTAMP - interval '6 hours') ELSE NULL END;
$$;

-- Tenant-owned AI Analytics plans (never global Admin plans).
CREATE TABLE "WorkspaceAnalyticsQuery" (
  "id" text NOT NULL,
  "workspaceId" text NOT NULL,
  "authorId" text NOT NULL,
  "question" text NOT NULL,
  "title" text NOT NULL,
  "plan" jsonb NOT NULL,
  "planHash" text NOT NULL,
  "pinned" boolean NOT NULL DEFAULT false,
  "lastRunAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  CONSTRAINT "WorkspaceAnalyticsQuery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceAnalyticsQuery_workspaceId_planHash_key" ON "WorkspaceAnalyticsQuery"("workspaceId","planHash");
CREATE INDEX "WorkspaceAnalyticsQuery_workspaceId_pinned_lastRunAt_idx" ON "WorkspaceAnalyticsQuery"("workspaceId","pinned","lastRunAt");
ALTER TABLE "WorkspaceAnalyticsQuery" ADD CONSTRAINT "WorkspaceAnalyticsQuery_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceAnalyticsQuery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceAnalyticsQuery" FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_analytics_managers ON "WorkspaceAnalyticsQuery" FOR ALL
USING (public.workspace_manager_reads("workspaceId"))
WITH CHECK (public.workspace_manager_reads("workspaceId") AND "authorId"=current_setting('app.workspace_actor_id',true));

-- Feedback numbers come from one sequence: a row count is wrong once row isolation
-- hides other workspaces' feedback, and would collide on the unique number.
CREATE SEQUENCE public.user_feedback_number_seq;
SELECT setval('public.user_feedback_number_seq', coalesce((SELECT max(substring("feedbackNumber" from '^FB-([0-9]+)$')::bigint)
  FROM public."UserFeedback"), 0) + 1, false);
CREATE FUNCTION public.next_feedback_number() RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT 'FB-'||lpad(nextval('public.user_feedback_number_seq')::text, 5, '0');
$$;
