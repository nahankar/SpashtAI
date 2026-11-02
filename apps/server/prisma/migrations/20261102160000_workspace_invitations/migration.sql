-- Platform invitations retain null scope. Organization invitations cannot be relocated.
ALTER TABLE "UserInvitation" ADD COLUMN "workspaceId" text,
 ADD COLUMN "proposedRole" "WorkspaceMemberRole", ADD COLUMN "memberFeatures" jsonb NOT NULL DEFAULT '{}';
ALTER TABLE "UserInvitation" ADD CONSTRAINT "UserInvitation_workspaceId_fkey"
 FOREIGN KEY ("workspaceId") REFERENCES "Workspace"(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserInvitation" ADD CONSTRAINT invitation_target_role CHECK
 (("workspaceId" IS NULL AND "proposedRole" IS NULL AND "memberFeatures"='{}') OR ("workspaceId" IS NOT NULL AND "proposedRole" IS NOT NULL));
ALTER TABLE "UserInvitation" ADD CONSTRAINT invitation_member_settings CHECK (jsonb_typeof("memberFeatures")='object');
CREATE INDEX "UserInvitation_workspaceId_status_expiresAt_idx" ON "UserInvitation"("workspaceId",status,"expiresAt");

CREATE FUNCTION public.invitation_manager(p_workspace text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT (p_workspace IS NULL AND nullif(current_setting('app.workspace_id',true),'') IS NULL)
 OR (p_workspace=current_setting('app.workspace_id',true) AND EXISTS (
 SELECT 1 FROM public."Workspace" w JOIN public."WorkspaceMember" m ON m."workspaceId"=w.id
 WHERE w.id=p_workspace AND w.kind='ORGANIZATION' AND w.state='ACTIVE'
 AND m."userId"=current_setting('app.workspace_actor_id',true) AND m.state='ACTIVE' AND m.role IN ('OWNER','ADMIN')));
$$;
ALTER TABLE "UserInvitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserInvitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY invitation_read ON "UserInvitation" FOR SELECT USING
 (public.invitation_manager("workspaceId") OR "tokenHash"=current_setting('app.invitation_hash',true));
CREATE POLICY invitation_insert ON "UserInvitation" FOR INSERT WITH CHECK (public.invitation_manager("workspaceId"));
CREATE POLICY invitation_update ON "UserInvitation" FOR UPDATE USING
 (public.invitation_manager("workspaceId") OR "tokenHash"=current_setting('app.invitation_hash',true))
 WITH CHECK (public.invitation_manager("workspaceId") OR "tokenHash"=current_setting('app.invitation_hash',true));
CREATE POLICY invitation_delete ON "UserInvitation" FOR DELETE USING (public.invitation_manager("workspaceId"));
-- The verified recipient can lock the target before locking the invitation, consistently
-- with manager actions. No membership exists yet; possession authorizes this one target only.
CREATE POLICY workspace_invitation_entry ON "Workspace" FOR SELECT USING (EXISTS (
 SELECT 1 FROM "UserInvitation" i WHERE i."workspaceId"="Workspace".id AND i."tokenHash"=current_setting('app.invitation_hash',true)));

CREATE FUNCTION public.protect_invitation_target() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" OR NEW.email IS DISTINCT FROM OLD.email
 OR NEW."invitedById" IS DISTINCT FROM OLD."invitedById" OR NEW."proposedRole" IS DISTINCT FROM OLD."proposedRole" OR NEW."memberFeatures" IS DISTINCT FROM OLD."memberFeatures") THEN
  RAISE EXCEPTION 'Invitation target and proposed membership are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW."workspaceId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public."Workspace" WHERE id=NEW."workspaceId" AND kind='ORGANIZATION') THEN
  RAISE EXCEPTION 'Invitations require an organization workspace' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_invitation_target() FROM PUBLIC;
CREATE TRIGGER invitation_target_identity BEFORE INSERT OR UPDATE ON "UserInvitation"
 FOR EACH ROW EXECUTE FUNCTION public.protect_invitation_target();

-- Narrow maintenance functions: no row retrieval or general-purpose bypass. Retention
-- uses the same minimum 30-day floor as the service; user deletion resolves email itself.
CREATE FUNCTION public.purge_closed_invitations(p_cutoff timestamp) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE removed integer; cutoff timestamp := least(p_cutoff,CURRENT_TIMESTAMP-interval '30 days');
BEGIN
 DELETE FROM public."UserInvitation" WHERE
 (status='ACCEPTED' AND "acceptedAt"<cutoff) OR (status='REVOKED' AND "revokedAt"<cutoff)
 OR (status IN ('PENDING','EXPIRED') AND "expiresAt"<cutoff);
 GET DIAGNOSTICS removed=ROW_COUNT; RETURN removed;
END $$;
CREATE FUNCTION public.delete_user_invitations(p_user text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
DECLARE removed integer;
BEGIN
 IF current_setting('app.workspace_platform_admin',true) IS DISTINCT FROM 'true' OR NOT EXISTS (
 SELECT 1 FROM public."User" WHERE id=current_setting('app.workspace_actor_id',true) AND role IN ('ADMIN','SUPER_ADMIN')) THEN
 RAISE EXCEPTION 'Platform administrator required for account cleanup' USING ERRCODE='42501'; END IF;
 DELETE FROM public."UserInvitation" WHERE "acceptedUserId"=p_user OR email=(SELECT lower(email) FROM public."User" WHERE id=p_user);
 GET DIAGNOSTICS removed=ROW_COUNT; RETURN removed;
END $$;

-- Platform control-plane quota edits need counts across invitation RLS, never recipients.
CREATE FUNCTION public.workspace_reserved_seats(p_workspace text) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
BEGIN
 IF NOT coalesce(public.invitation_manager(p_workspace),false) AND NOT (
 coalesce(current_setting('app.workspace_platform_admin',true),'')='true' AND EXISTS (
 SELECT 1 FROM public."User" WHERE id=current_setting('app.workspace_actor_id',true) AND role IN ('ADMIN','SUPER_ADMIN'))) THEN
 RAISE EXCEPTION 'Workspace administrator required for seat counts' USING ERRCODE='42501'; END IF;
 RETURN (SELECT count(*) FROM public."WorkspaceMember" WHERE "workspaceId"=p_workspace AND state<>'SUSPENDED') +
 (SELECT count(*) FROM public."UserInvitation" i WHERE i."workspaceId"=p_workspace AND i.status='PENDING' AND i."expiresAt">CURRENT_TIMESTAMP
 AND NOT EXISTS (SELECT 1 FROM public."WorkspaceMember" m JOIN public."User" u ON u.id=m."userId"
 WHERE m."workspaceId"=p_workspace AND m.state<>'SUSPENDED' AND lower(u.email)=i.email));
END $$;
