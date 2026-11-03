-- Keep the previous one-argument discovery signature so a rolled-back
-- application revision can still start after this function migration.
-- The four-argument form remains the current worker contract.

CREATE FUNCTION public.workspace_job_scopes(p_job text)
RETURNS TABLE("workspaceId" text, "userId" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
  SELECT * FROM public.workspace_job_scopes(p_job, NULL::text, NULL::text, 50);
$$;
