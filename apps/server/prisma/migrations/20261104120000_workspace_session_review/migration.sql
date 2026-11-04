-- Read-only Owner/Admin review of learner activity inside one organization.
-- Adds a dedicated 'reviewer' reader. The 'manager' (aggregate) reader is unchanged
-- and still never sees child content.
--
-- Review visibility requires all of the following, rechecked for every row:
--   * app.workspace_reader = 'reviewer' (never set by product routes or jobs),
--   * a READ ONLY transaction, so review can never coexist with a write path,
--   * the row belongs to the verified current workspace (app.workspace_id),
--   * that workspace is an ACTIVE ORGANIZATION (Personal is never reviewable),
--   * the actor is an ACTIVE OWNER or ADMIN of it right now.
CREATE FUNCTION public.workspace_review_reads(p_workspace text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT coalesce(current_setting('app.workspace_reader',true),'')='reviewer'
 AND current_setting('transaction_read_only')='on'
 AND p_workspace=current_setting('app.workspace_id',true)
 AND EXISTS (SELECT 1 FROM public."Workspace" w JOIN public."WorkspaceMember" m ON m."workspaceId"=w.id
   WHERE w.id=p_workspace AND w.kind='ORGANIZATION' AND w.state='ACTIVE'
   AND m."userId"=current_setting('app.workspace_actor_id',true) AND m.state='ACTIVE' AND m.role IN ('OWNER','ADMIN'));
$$;

-- Prepare is not reviewable yet. Its link tables hang off Preparation, which reviewers
-- cannot see, so the exclusion is decided here without exposing Prepare rows.
CREATE FUNCTION public.workspace_review_excludes_prepare(p_table text, p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT CASE p_table
  WHEN 'Session' THEN NOT EXISTS (SELECT 1 FROM public."PreparationPractice" p WHERE p."sessionId"=p_id)
  WHEN 'ReplaySession' THEN NOT EXISTS (SELECT 1 FROM public."PreparationRecording" p WHERE p."replaySessionId"=p_id)
  ELSE false END;
$$;

-- Roots of Elevate, Interviews and Replay. SELECT only; child tables (transcripts, turns,
-- recordings, metrics, interview runs/attempts/answers/assessments, Replay results and
-- uploads) already admit reads of a visible parent for every reader except 'manager'.
CREATE POLICY workspace_review_read ON "Session" FOR SELECT USING (
  "workspaceKind"='ORGANIZATION' AND "discardedAt" IS NULL AND purpose IN ('COMMUNICATION','INTERVIEW')
  AND public.workspace_review_reads("workspaceId") AND public.workspace_review_excludes_prepare('Session', id));
CREATE POLICY workspace_review_read ON "ReplaySession" FOR SELECT USING (
  "workspaceKind"='ORGANIZATION' AND purpose='COMMUNICATION'
  AND public.workspace_review_reads("workspaceId") AND public.workspace_review_excludes_prepare('ReplaySession', id));
