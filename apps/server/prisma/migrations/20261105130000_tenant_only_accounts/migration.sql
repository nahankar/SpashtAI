ALTER TABLE "User" ADD COLUMN "tenantOnly" BOOLEAN NOT NULL DEFAULT false;

-- Accepted organization identities keep their retained Personal data, but lose Personal access.
-- Membership suspension/removal never implicitly grants Personal access again.
UPDATE "User" u SET "tenantOnly" = true WHERE EXISTS (
  SELECT 1 FROM "WorkspaceMember" m JOIN "Workspace" w ON w.id = m."workspaceId"
  WHERE m."userId" = u.id AND w.kind = 'ORGANIZATION' AND m."acceptedAt" IS NOT NULL
) OR EXISTS (
  SELECT 1 FROM "UserInvitation" i WHERE i."acceptedUserId" = u.id
  AND i."workspaceId" IS NOT NULL AND i.status = 'ACCEPTED'
);

-- Covers invitation acceptance, direct membership acceptance, and future enrollment paths.
-- Runs with the caller's workspace context and rolls back with the membership transaction.
CREATE FUNCTION mark_accepted_member_tenant_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."acceptedAt" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "Workspace" WHERE id = NEW."workspaceId" AND kind = 'ORGANIZATION'
  ) THEN
    UPDATE "User" SET "tenantOnly" = true WHERE id = NEW."userId" AND NOT "tenantOnly";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER accepted_member_tenant_only
AFTER INSERT OR UPDATE OF state, "acceptedAt" ON "WorkspaceMember"
FOR EACH ROW EXECUTE FUNCTION mark_accepted_member_tenant_only();
