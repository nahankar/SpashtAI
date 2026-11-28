BEGIN;
-- Keep one current invitation per organization mailbox; resends update it in place.
LOCK TABLE "UserInvitation" IN SHARE ROW EXCLUSIVE MODE;
WITH ranked AS (
 SELECT id, row_number() OVER (PARTITION BY "workspaceId", lower(btrim(email)) ORDER BY "createdAt" DESC, id DESC) AS n
 FROM "UserInvitation" WHERE "workspaceId" IS NOT NULL
)
DELETE FROM "UserInvitation" i USING ranked r WHERE i.id=r.id AND r.n>1;
CREATE UNIQUE INDEX "UserInvitation_workspace_email_key"
 ON "UserInvitation" ("workspaceId", lower(btrim(email))) WHERE "workspaceId" IS NOT NULL;
COMMIT;
