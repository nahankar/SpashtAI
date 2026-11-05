-- Tenant managers can erase only a selected, manageable member's organization data.
-- The transaction keeps the membership until erasure and its outboxes are committed.
CREATE FUNCTION public.workspace_member_erasure_permits(p_workspace text, p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT coalesce(current_setting('app.workspace_reader',true),'')='member_erasure'
 AND p_workspace=current_setting('app.workspace_id',true)
 AND EXISTS (SELECT 1 FROM public."Workspace" w
 JOIN public."WorkspaceMember" actor ON actor."workspaceId"=w.id
 JOIN public."WorkspaceMember" target ON target."workspaceId"=w.id
 WHERE w.id=p_workspace AND w.kind='ORGANIZATION' AND w.state='ACTIVE'
 AND actor."userId"=current_setting('app.workspace_actor_id',true) AND actor.state='ACTIVE'
 AND actor.role IN ('OWNER','ADMIN') AND target."userId"=p_user
 AND target.id=current_setting('app.workspace_erasure_member',true)
 AND target."userId"<>actor."userId" AND (actor.role='OWNER' OR target.role='LEARNER'));
$$;

DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['Session','ReplaySession','Preparation','ProgressPulse','FeatureUsage','CoachThread','CoachHomeResultReceipt','UserFeedback'] LOOP
  EXECUTE format('CREATE POLICY member_erasure_read ON public.%I FOR SELECT USING (public.workspace_member_erasure_permits("workspaceId","userId"))',tbl);
  IF tbl <> 'Session' THEN
   EXECUTE format('CREATE POLICY member_erasure_delete ON public.%I FOR DELETE USING (public.workspace_member_erasure_permits("workspaceId","userId"))',tbl);
  END IF;
 END LOOP;
END $$;
CREATE POLICY member_erasure_tombstone ON "Session" FOR UPDATE
 USING (public.workspace_member_erasure_permits("workspaceId","userId"))
 WITH CHECK ("discardedAt" IS NOT NULL AND public.workspace_member_erasure_permits("workspaceId","userId"));
CREATE POLICY member_erasure_plan_read ON "WorkspaceAnalyticsQuery" FOR SELECT
 USING (public.workspace_member_erasure_permits("workspaceId","authorId"));
CREATE POLICY member_erasure_plan_delete ON "WorkspaceAnalyticsQuery" FOR DELETE
 USING (public.workspace_member_erasure_permits("workspaceId","authorId"));
CREATE POLICY membership_delete ON "WorkspaceMember" FOR DELETE USING (
 public.workspace_member_erasure_permits("workspaceId","userId"));
