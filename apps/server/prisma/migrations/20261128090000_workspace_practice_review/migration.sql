BEGIN;
-- Read-only review by current tenant managers. Personal and other tenants stay private.
CREATE FUNCTION public.workspace_practice_review(p_workspace text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT coalesce(current_setting('app.workspace_reader',true),'')='practice_review'
 AND p_workspace=current_setting('app.workspace_id',true)
 AND EXISTS (SELECT 1 FROM public."Workspace" w JOIN public."WorkspaceMember" m ON m."workspaceId"=w.id
   WHERE w.id=p_workspace AND w.kind='ORGANIZATION' AND w.state='ACTIVE'
   AND m."userId"=current_setting('app.workspace_actor_id',true) AND m.state='ACTIVE' AND m.role IN ('OWNER','ADMIN'));
$$;
CREATE POLICY workspace_practice_review ON "Session" FOR SELECT
 USING ("discardedAt" IS NULL AND public.workspace_practice_review("workspaceId"));
CREATE POLICY workspace_practice_review ON "ReplaySession" FOR SELECT
 USING (public.workspace_practice_review("workspaceId"));
CREATE POLICY workspace_practice_review ON "Preparation" FOR SELECT
 USING (public.workspace_practice_review("workspaceId"));
-- Children inherit visible parents. Even the reviewer's own records cannot be mutated in review mode.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['Session','SessionMetrics','SessionRecording','SessionSegment','SessionTranscript','SessionTurn',
  'ReplaySession','ReplayUpload','ReplayResult','Preparation','InterviewPreparation','PreparationStage','InterviewQuestion',
  'StageReflection','PreparationPractice','PreparationRecording','InterviewRun','InterviewAttempt','InterviewAnswerSnapshot',
  'InterviewAssessment','InterviewAnswerChunk','InterviewCaptureReceipt','InterviewTranscriptIssue','BankFollowUpJob'] LOOP
  EXECUTE format('CREATE POLICY practice_review_no_insert ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (coalesce(current_setting(''app.workspace_reader'',true),'''')<>''practice_review'')',tbl);
  EXECUTE format('CREATE POLICY practice_review_no_update ON public.%I AS RESTRICTIVE FOR UPDATE USING (coalesce(current_setting(''app.workspace_reader'',true),'''')<>''practice_review'') WITH CHECK (coalesce(current_setting(''app.workspace_reader'',true),'''')<>''practice_review'')',tbl);
  EXECUTE format('CREATE POLICY practice_review_no_delete ON public.%I AS RESTRICTIVE FOR DELETE USING (coalesce(current_setting(''app.workspace_reader'',true),'''')<>''practice_review'')',tbl);
 END LOOP;
END $$;

COMMIT;
