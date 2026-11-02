-- Platform account deletion must not strand an organization. Tenant membership
-- mutations use the same workspace row lock. Personal-only deletion is unchanged.
CREATE FUNCTION public.protect_workspace_owner_on_identity_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE organization record;
BEGIN
  FOR organization IN
    SELECT w.id, m.state FROM public."Workspace" w JOIN public."WorkspaceMember" m ON m."workspaceId"=w.id
    WHERE w.kind='ORGANIZATION' AND m."userId"=OLD.id AND m.role='OWNER' AND m.state <> 'SUSPENDED'
    ORDER BY w.id FOR UPDATE OF w
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public."WorkspaceMember" m WHERE m."workspaceId"=organization.id
      AND m."userId" <> OLD.id AND m.role='OWNER' AND
      (m.state='ACTIVE' OR (organization.state='INVITED' AND m.state='INVITED'))) THEN
      RAISE EXCEPTION 'Transfer workspace ownership before deleting this account'
        USING ERRCODE='23503', CONSTRAINT='workspace_active_owner_required';
    END IF;
  END LOOP;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_workspace_owner_on_identity_delete() FROM PUBLIC;
CREATE TRIGGER workspace_owner_identity_delete BEFORE DELETE ON public."User"
FOR EACH ROW EXECUTE FUNCTION public.protect_workspace_owner_on_identity_delete();
