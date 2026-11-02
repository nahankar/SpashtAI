-- Stage 2: isolate the Session aggregate without enabling organization workflows.
CREATE UNIQUE INDEX "Workspace_id_kind_key" ON "Workspace"(id,kind);
ALTER TABLE "Session" ADD COLUMN "workspaceId" text NOT NULL DEFAULT '',
  ADD COLUMN "workspaceKind" "WorkspaceKind" NOT NULL DEFAULT 'PERSONAL';

-- Accounts created since the foundation migration may not have opened the chooser.
INSERT INTO "Workspace" (id,kind,slug,name,"personalOwnerId","isolationStage","maxMembers","updatedAt")
SELECT 'personal_'||u.id,'PERSONAL','personal-'||lower(u.id),'Personal',u.id,'PERSONAL_LEGACY',1,CURRENT_TIMESTAMP
FROM "User" u WHERE NOT EXISTS (SELECT 1 FROM "Workspace" w WHERE w."personalOwnerId"=u.id)
ON CONFLICT ("personalOwnerId") DO NOTHING;
INSERT INTO "WorkspaceMember" (id,"workspaceId","userId",role,state,"acceptedAt","updatedAt")
SELECT 'personal_member_'||w."personalOwnerId",w.id,w."personalOwnerId",'OWNER','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM "Workspace" w WHERE w.kind='PERSONAL'
ON CONFLICT ("workspaceId","userId") DO NOTHING;
UPDATE "Session" s SET "workspaceId"=w.id,"workspaceKind"='PERSONAL'
FROM "Workspace" w WHERE w."personalOwnerId"=s."userId" AND w.kind='PERSONAL';
ALTER TABLE "Session" ADD CONSTRAINT "Session_workspaceId_workspaceKind_fkey"
FOREIGN KEY ("workspaceId","workspaceKind") REFERENCES "Workspace"(id,kind) ON DELETE CASCADE ON UPDATE NO ACTION;
CREATE INDEX "Session_workspaceId_userId_startedAt_idx" ON "Session"("workspaceId","userId","startedAt");

CREATE FUNCTION public.assign_session_workspace() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE parent public."Workspace"%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" OR NEW."workspaceKind" IS DISTINCT FROM OLD."workspaceKind"
      OR NEW."userId" IS DISTINCT FROM OLD."userId" THEN
      RAISE EXCEPTION 'Session workspace ownership is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF coalesce(NEW."workspaceId",'')='' THEN
    IF nullif(current_setting('app.workspace_id',true),'') IS NOT NULL THEN
      RAISE EXCEPTION 'Workspace session creation requires explicit ownership' USING ERRCODE='42501';
    END IF;
    -- Trigger-owned compatibility bridge for legacy Personal inserts. No organization
    -- access is inferred from a membership, request header, user preference or URL.
    INSERT INTO public."Workspace" (id,kind,slug,name,"personalOwnerId","isolationStage","maxMembers","updatedAt")
    VALUES ('personal_'||NEW."userId",'PERSONAL','personal-'||lower(NEW."userId"),'Personal',NEW."userId",'PERSONAL_LEGACY',1,CURRENT_TIMESTAMP)
    ON CONFLICT ("personalOwnerId") DO NOTHING;
    SELECT * INTO parent FROM public."Workspace" WHERE "personalOwnerId"=NEW."userId";
    INSERT INTO public."WorkspaceMember" (id,"workspaceId","userId",role,state,"acceptedAt","updatedAt")
    VALUES ('personal_member_'||NEW."userId",parent.id,NEW."userId",'OWNER','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT ("workspaceId","userId") DO NOTHING;
    NEW."workspaceId" := parent.id;
  ELSE
    SELECT * INTO parent FROM public."Workspace" WHERE id=NEW."workspaceId";
  END IF;
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
REVOKE ALL ON FUNCTION public.assign_session_workspace() FROM PUBLIC;
CREATE TRIGGER session_workspace_identity BEFORE INSERT OR UPDATE ON "Session"
FOR EACH ROW EXECUTE FUNCTION public.assign_session_workspace();

-- This boolean predicate deliberately exposes no records. Legacy Personal
-- application authorization remains in place; empty context never includes orgs.
CREATE FUNCTION public.session_workspace_permits(p_workspace text,p_kind public."WorkspaceKind",p_user text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT (p_kind='PERSONAL' AND nullif(current_setting('app.workspace_id',true),'') IS NULL)
 OR (p_workspace=current_setting('app.workspace_id',true) AND p_user=current_setting('app.workspace_actor_id',true)
 AND EXISTS (SELECT 1 FROM public."Workspace" w JOIN public."WorkspaceMember" m ON m."workspaceId"=w.id
 WHERE w.id=p_workspace AND w.state='ACTIVE' AND m."userId"=p_user AND m.state='ACTIVE'));
$$;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" FORCE ROW LEVEL SECURITY;
CREATE POLICY session_workspace_boundary ON "Session" FOR ALL
USING (public.session_workspace_permits("workspaceId","workspaceKind","userId"))
WITH CHECK (public.session_workspace_permits("workspaceId","workspaceKind","userId"));

-- Child ownership is inherited through the globally unique parent session ID.
DO $$ DECLARE child text; BEGIN
 FOREACH child IN ARRAY ARRAY['SessionMetrics','SessionTranscript','SessionSegment','SessionTurn','SessionRecording'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',child);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',child);
  EXECUTE format('CREATE POLICY session_parent_boundary ON public.%I FOR ALL USING (EXISTS (SELECT 1 FROM public."Session" s WHERE s.id="sessionId")) WITH CHECK (EXISTS (SELECT 1 FROM public."Session" s WHERE s.id="sessionId"))',child);
 END LOOP;
END $$;

-- Preserve existing SET NULL behavior for deleted segments, while refusing
-- cross-session references or activity relocation (including same-workspace moves).
CREATE FUNCTION public.protect_session_child_parent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE segment_id text;
BEGIN
 IF TG_OP='UPDATE' AND NEW."sessionId" IS DISTINCT FROM OLD."sessionId" THEN
  RAISE EXCEPTION 'Session child ownership is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME IN ('SessionTurn','SessionRecording') THEN
  segment_id := to_jsonb(NEW)->>'segmentId';
  IF segment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."SessionSegment" s WHERE s.id=segment_id AND s."sessionId"=NEW."sessionId") THEN
   RAISE EXCEPTION 'Segment does not belong to this session' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_session_child_parent() FROM PUBLIC;
DO $$ DECLARE child text; BEGIN
 FOREACH child IN ARRAY ARRAY['SessionMetrics','SessionTranscript','SessionSegment','SessionTurn','SessionRecording'] LOOP
  EXECUTE format('CREATE TRIGGER session_child_identity BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.protect_session_child_parent()',child);
 END LOOP;
END $$;

-- Reject bridges to products whose tenant data planes are still unimplemented.
CREATE FUNCTION public.reject_unscoped_org_session_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE linked text;
BEGIN
 IF TG_TABLE_NAME='CoachAction' THEN
  IF NEW.module <> 'elevate' THEN RETURN NEW; END IF;
  linked := NEW."targetId";
 ELSIF TG_TABLE_NAME='ProgressPulse' THEN
  IF NEW.source <> 'elevate' THEN RETURN NEW; END IF;
  linked := NEW."sessionId";
 ELSE linked := NEW."sessionId";
 END IF;
 IF EXISTS (SELECT 1 FROM public."Session" s WHERE s.id=linked AND s."workspaceKind"='ORGANIZATION') THEN
  RAISE EXCEPTION 'Organization product association is not certified yet' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.reject_unscoped_org_session_link() FROM PUBLIC;
DO $$ DECLARE child text; BEGIN
 FOREACH child IN ARRAY ARRAY['PreparationPractice','InterviewRun','BankFollowUpJob','ProgressPulse','CoachAction'] LOOP
  EXECUTE format('CREATE TRIGGER reject_unscoped_org_session BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_unscoped_org_session_link()',child);
 END LOOP;
END $$;
