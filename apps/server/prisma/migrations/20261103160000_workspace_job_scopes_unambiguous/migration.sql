-- Default arguments on the four-parameter form made workspace_job_scopes('job')
-- ambiguous with the compatibility wrapper. Callers pass four arguments or one.

DROP FUNCTION IF EXISTS public.workspace_job_scopes(text, text, text, integer);

CREATE FUNCTION public.workspace_job_scopes(
  p_job text,
  p_after_workspace text,
  p_after_user text,
  p_limit integer
) RETURNS TABLE("workspaceId" text, "userId" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT DISTINCT s."workspaceId", s."userId" FROM public."Session" s
 JOIN public."Workspace" w ON w.id=s."workspaceId" AND w.kind='ORGANIZATION'
 WHERE s."workspaceKind"='ORGANIZATION' AND CASE p_job
  WHEN 'session_deletion' THEN s."discardedAt" IS NOT NULL
    AND (s."nextDeletionAttemptAt" IS NULL OR s."nextDeletionAttemptAt" <= CURRENT_TIMESTAMP)
  WHEN 'pace_reconciliation' THEN s."discardedAt" IS NULL
    AND s."paceReconciliationStatus" IN ('pending','processing','retry','waiting_for_evidence')
    AND (s."nextPaceReconciliationAt" IS NULL OR s."nextPaceReconciliationAt" <= CURRENT_TIMESTAMP)
  WHEN 'delivery_alignment' THEN s."discardedAt" IS NULL AND s."endedAt" IS NOT NULL
    AND s."deliveryAlignmentStatus" IN ('pending','processing','retry')
    AND (s."deliveryAlignmentNextAt" IS NULL OR s."deliveryAlignmentNextAt" <= CURRENT_TIMESTAMP)
  WHEN 'session_inactivity' THEN s."discardedAt" IS NULL AND s."endedAt" IS NULL
    AND s."startedAt" < CURRENT_TIMESTAMP - interval '23 hours'
  WHEN 'audio_enrichment' THEN s."discardedAt" IS NULL AND EXISTS (
    SELECT 1 FROM public."SessionMetrics" m WHERE m."sessionId"=s.id
      AND m."processingStatus"->>'audioEnrichmentStatus' IN ('retry','processing')
      AND COALESCE((m."processingStatus"->>'audioEnrichmentNextRetryAt')::timestamptz, '-infinity'::timestamptz) <= CURRENT_TIMESTAMP)
  WHEN 'learner_evaluation' THEN s."discardedAt" IS NULL AND EXISTS (
    SELECT 1 FROM public."InterviewRun" r
    JOIN public."InterviewAttempt" a ON a."runId"=r.id
    JOIN public."InterviewAnswerSnapshot" n ON n."attemptId"=a.id
    JOIN public."InterviewAssessment" x ON x."snapshotId"=n.id
    WHERE r."sessionId"=s.id AND (
      x.status='PENDING' OR (x.status='RUNNING' AND x."leaseUntil" < CURRENT_TIMESTAMP)))
  ELSE false END
 AND (p_job='session_deletion' OR (w.state='ACTIVE' AND EXISTS (SELECT 1 FROM public."WorkspaceMember" m
   WHERE m."workspaceId"=w.id AND m."userId"=s."userId" AND m.state='ACTIVE')))
 AND nullif(current_setting('app.workspace_id',true),'') IS NULL
 AND (p_after_workspace IS NULL OR (s."workspaceId", s."userId") > (p_after_workspace, COALESCE(p_after_user, '')))
 ORDER BY s."workspaceId", s."userId"
 LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

GRANT EXECUTE ON FUNCTION public.workspace_job_scopes(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.workspace_job_scopes(text, text, text, integer) TO PUBLIC;
