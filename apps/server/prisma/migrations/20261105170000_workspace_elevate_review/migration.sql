-- Owners/Admins may review Elevate activity only in their current organization.
-- This is a read context; aggregate reports keep their existing manager policy.
CREATE FUNCTION public.workspace_elevate_review(p_workspace text, p_session text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT coalesce(current_setting('app.workspace_reader',true),'')='session_review'
 AND p_workspace=current_setting('app.workspace_id',true)
 AND EXISTS (SELECT 1 FROM public."Workspace" w JOIN public."WorkspaceMember" m ON m."workspaceId"=w.id
  WHERE w.id=p_workspace AND w.kind='ORGANIZATION' AND w.state='ACTIVE'
  AND m."userId"=current_setting('app.workspace_actor_id',true) AND m.state='ACTIVE' AND m.role IN ('OWNER','ADMIN'))
 AND EXISTS (SELECT 1 FROM public."Session" s WHERE s.id=p_session AND s."workspaceId"=p_workspace
  AND s."workspaceKind"='ORGANIZATION' AND s.purpose='COMMUNICATION' AND s."discardedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM public."PreparationPractice" pp WHERE pp."sessionId"=s.id));
$$;
CREATE POLICY workspace_elevate_review ON "Session" FOR SELECT
 USING (public.workspace_elevate_review("workspaceId",id));
CREATE POLICY workspace_elevate_review_pulse ON "ProgressPulse" FOR SELECT
 USING (source='elevate' AND public.workspace_elevate_review("workspaceId","sessionId"));

-- Child policies inherit parent visibility. Do not let that new read access grant
-- writes through a GET handler that refreshes derived data while rendering results.
CREATE FUNCTION public.workspace_review_write_permits(p_session text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT coalesce(current_setting('app.workspace_reader',true),'')<>'session_review'
 OR EXISTS (SELECT 1 FROM public."Session" s WHERE s.id=p_session AND s."userId"=current_setting('app.workspace_actor_id',true));
$$;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['SessionMetrics','SessionTranscript','SessionSegment','SessionTurn','SessionRecording'] LOOP
  EXECUTE format('CREATE POLICY review_no_insert ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (public.workspace_review_write_permits("sessionId"))',tbl);
  EXECUTE format('CREATE POLICY review_no_update ON public.%I AS RESTRICTIVE FOR UPDATE USING (public.workspace_review_write_permits("sessionId")) WITH CHECK (public.workspace_review_write_permits("sessionId"))',tbl);
  EXECUTE format('CREATE POLICY review_no_delete ON public.%I AS RESTRICTIVE FOR DELETE USING (public.workspace_review_write_permits("sessionId"))',tbl);
 END LOOP;
END $$;
