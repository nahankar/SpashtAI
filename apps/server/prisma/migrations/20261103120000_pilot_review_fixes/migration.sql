-- Fair, due-only job discovery and platform-wide practice aggregates.
-- Discovery stays SECURITY DEFINER and content-free. Platform totals require
-- the transaction-local platform-admin flag; they never return raw learner rows.

DROP FUNCTION IF EXISTS public.workspace_job_scopes(text);

CREATE FUNCTION public.workspace_job_scopes(
  p_job text,
  p_after_workspace text DEFAULT NULL,
  p_after_user text DEFAULT NULL,
  p_limit integer DEFAULT 50
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

CREATE FUNCTION public.platform_practice_totals(p_workspace text)
RETURNS TABLE(
  elevate_total bigint,
  elevate_month bigint,
  replay_total bigint,
  replay_month bigint,
  interview_runs bigint,
  pulse_participants bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
BEGIN
  IF current_setting('app.workspace_platform_admin', true) IS DISTINCT FROM 'true' THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (
      WHERE s.purpose='COMMUNICATION' AND s."discardedAt" IS NULL
        AND NOT EXISTS (SELECT 1 FROM public."PreparationPractice" pp WHERE pp."sessionId"=s.id)
    )::bigint,
    COUNT(*) FILTER (
      WHERE s.purpose='COMMUNICATION' AND s."discardedAt" IS NULL AND s."startedAt" >= CURRENT_TIMESTAMP - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM public."PreparationPractice" pp WHERE pp."sessionId"=s.id)
    )::bigint,
    (SELECT COUNT(*) FROM public."ReplaySession" r
      WHERE (p_workspace IS NULL OR r."workspaceId"=p_workspace)
        AND r.purpose='COMMUNICATION'
        AND NOT EXISTS (SELECT 1 FROM public."PreparationRecording" pr WHERE pr."replaySessionId"=r.id)),
    (SELECT COUNT(*) FROM public."ReplaySession" r
      WHERE (p_workspace IS NULL OR r."workspaceId"=p_workspace)
        AND r.purpose='COMMUNICATION' AND r."createdAt" >= CURRENT_TIMESTAMP - interval '30 days'
        AND NOT EXISTS (SELECT 1 FROM public."PreparationRecording" pr WHERE pr."replaySessionId"=r.id)),
    (SELECT COUNT(*) FROM public."InterviewRun" ir
      JOIN public."Session" isess ON isess.id=ir."sessionId"
      WHERE (p_workspace IS NULL OR isess."workspaceId"=p_workspace) AND isess."discardedAt" IS NULL),
    (SELECT COUNT(DISTINCT p."userId") FROM public."ProgressPulse" p
      WHERE (p_workspace IS NULL OR p."workspaceId"=p_workspace))
  FROM public."Session" s
  WHERE p_workspace IS NULL OR s."workspaceId"=p_workspace;
END;
$$;
